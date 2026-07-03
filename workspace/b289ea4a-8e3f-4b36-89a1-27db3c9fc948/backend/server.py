from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/api/status")
async def status():
    return {"agents": "running"}
