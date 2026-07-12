import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        service: "MeetMind Metadata Service",
        version: "1.0.0",
        status: "ok"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "healthy"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Metadata Service started on port ${PORT}`);
});
