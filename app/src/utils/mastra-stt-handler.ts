import { OpenAIRealtimeVoice } from "@mastra/voice-openai-realtime";
import { WebSocket as WS, WebSocketServer as WSS } from "ws";
import http from "http";

interface TranscriptMessage {
    type: "transcript" | "status" | "error";
    text?: string;
    role?: string;
    final?: boolean;
    status?: string;
    error?: string;
}

/**
 * Creates a WebSocket server for real-time speech-to-text transcription
 * using Mastra's OpenAI Realtime Voice API.
 */
export function createSTTWebSocketServer(server: http.Server, path: string = "/stt") {
    const wss = new WSS({ server, path });

    console.log(`[STT] WebSocket server ready at ws://localhost:${process.env.NODE_PORT}${path}`);

    wss.on("connection", async (clientWs: WS) => {
        console.log("[STT] New client connected");

        let voice: OpenAIRealtimeVoice | null = null;
        let isConnected = false;

        const sendToClient = (message: TranscriptMessage) => {
            if (clientWs.readyState === WS.OPEN) {
                clientWs.send(JSON.stringify(message));
            }
        };

        try {
            // Initialize OpenAI Realtime Voice for STT only
            voice = new OpenAIRealtimeVoice({
                model: "gpt-4o-mini-realtime-preview-2024-12-17",
                apiKey: process.env.OPENAI_API_KEY,
            });

            // Configure for speech-to-text only (no AI audio response)
            voice.updateConfig({
                // Text only modality - no audio responses from AI
                // modalities: ["text"],
                // language: "en",
                input_audio_transcription: {
                    model: "gpt-4o-transcribe",
                },
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 800,
                },
            });

            // Tell the model not to respond - we only want transcription
            voice.addInstructions(
                "You are a transcription-only system. DO NOT respond to the user. " +
                "DO NOT generate any text output. Your only job is to transcribe audio. " +
                "Never reply, never acknowledge, never assist. Complete silence. You only transcribe english"
            );

            // Listen for transcription events - filter for user role only
            voice.on("writing", ({ text, role }: { text: string; role: string }) => {
                // Only send user transcription, ignore assistant responses
                if (role === "user") {
                    console.log(`[STT] User transcription: ${text}`);
                    sendToClient({
                        type: "transcript",
                        text,
                        role: "user",
                        final: true,
                    });
                }
                // Silently ignore assistant - don't even log
            });

            // Listen for errors
            voice.on("error", (error) => {
                console.error("[STT] Voice error:", error);
                sendToClient({
                    type: "error",
                    error: error.message || "Unknown error occurred",
                });
            });

            // Connect to OpenAI
            sendToClient({ type: "status", status: "connecting" });
            await voice.connect();
            isConnected = true;
            sendToClient({ type: "status", status: "connected" });
            console.log("[STT] Connected to OpenAI Realtime API");

            // Handle incoming audio data from client
            clientWs.on("message", async (data: Buffer) => {
                if (!isConnected || !voice) return;

                try {
                    // Check if it's a control message (JSON)
                    if (data[0] === 0x7b) {
                        // '{' character
                        const message = JSON.parse(data.toString());
                        if (message.type === "stop") {
                            console.log("[STT] Client requested stop");
                            return;
                        }
                    }

                    // Otherwise, it's audio data - send to OpenAI
                    // Copy buffer to ensure proper alignment for Int16Array
                    const alignedBuffer = Buffer.from(data);
                    const int16Array = new Int16Array(
                        alignedBuffer.buffer,
                        alignedBuffer.byteOffset,
                        alignedBuffer.byteLength / 2
                    );
                    voice.send(int16Array);
                } catch (error) {
                    console.error("[STT] Error processing audio:", error);
                }
            });

            clientWs.on("close", () => {
                console.log("[STT] Client disconnected");
                if (voice) {
                    voice.close();
                    voice = null;
                }
                isConnected = false;
            });

            clientWs.on("error", (error) => {
                console.error("[STT] WebSocket error:", error);
                if (voice) {
                    voice.close();
                    voice = null;
                }
                isConnected = false;
            });
        } catch (error: any) {
            console.error("[STT] Error setting up voice:", error);
            sendToClient({
                type: "error",
                error: error.message || "Failed to initialize voice connection",
            });
            clientWs.close();
        }
    });

    return wss;
}
