import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from google import genai
from google.genai import types, errors

# Global Client & Lifecycle Management 
# Reusing the client across requests eliminates connection setup overhead.
ai_client: genai.Client | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global ai_client
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("⚠️ WARNING: GEMINI_API_KEY is not set. API calls will fail.")
    else:
        # Initialize client once on startup
        ai_client = genai.Client(api_key=api_key)
        print("✅ Gemini Client successfully initialized.")
    yield
    # Cleanup on shutdown if needed
    ai_client = None

app = FastAPI(title="Fact Check API", lifespan=lifespan)

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://www.youtube.com",
        "https://youtube.com",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],  # Restrict to needed methods only
    allow_headers=["Content-Type", "Authorization"],
)

# Structured Data Models
class Payload(BaseModel):
    text: str = Field(
        ..., 
        min_length=3, 
        max_length=2000, 
        description="Subtitle text to analyze"
    )

# Pydantic schema passed directly to Gemini for forced JSON output
class FactCheckResult(BaseModel):
    misinformation: bool = Field(description="True if the text contains factual inaccuracies or misinformation.")
    claim: str = Field(description="The primary factual claim extracted from the text.")
    correction: str = Field(description="The accurate explanation or fact-check correction if misinformation is present, otherwise 'No issues found.'")

# Main Endpoint 
@app.post(
    "/api/check", 
    response_model=FactCheckResult,
    status_code=status.HTTP_200_OK
)
async def check_fact(payload: Payload):
    if not ai_client:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Gemini AI client is not initialized. Check server API key configuration."
        )
    
    # Sanitize input
    cleaned_text = payload.text.strip()
    if not cleaned_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Text payload cannot be empty or whitespace."
        )

    try:
        # Force Gemini to return data matching FactCheckResult schema
        response = ai_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=f"Analyze this subtitle text for factual accuracy and misinformation: '{cleaned_text}'",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=FactCheckResult,
                temperature=0.1,  # Low temperature for deterministic, factual output
            )
        )
        
        # response.parsed contains the validated Pydantic model automatically
        return response.parsed

    except errors.APIError as ae:
        print(f"🔴 Gemini API Error: {ae}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, 
            detail="Upstream AI service error."
        )
    except errors.ClientError as ce:
        print(f"🔴 Gemini Client Error: {ce}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Invalid request or configuration."
        )
    except Exception as e:
        print(f"🔴 System Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail="An unexpected error occurred."
        )