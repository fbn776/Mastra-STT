import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import { createSTTWebSocketServer } from "./utils/mastra-stt-handler";

require('dotenv').config();

const app = express();

const server = http.createServer(app);
const env = process.env.ENVIRONMENT || 'development';

if (env === 'development') {
    app.use(morgan('dev'));
}

app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json());
app.use(cors({
    "origin": "*",
    "methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "preflightContinue": false,
    "optionsSuccessStatus": 204
}));

//Invoking server port connection
server.listen(process.env.NODE_PORT, () => {
    console.log(`Server listening on port ${process.env.NODE_PORT}`);
    if (env === 'development') {
        console.log(`WebSocket server ready at ws://localhost:${process.env.NODE_PORT}`);
        // Initialize STT WebSocket server for development
        createSTTWebSocketServer(server, "/stt");
    }
});

//404 implementation
app.use(function (req, res) {
    let response = {
        "success": false,
        "status": 404,
        "message": "API not found",
        "data": null
    }
    res.status(404).send(response);
});
