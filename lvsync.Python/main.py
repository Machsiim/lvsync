from dotenv import load_dotenv
from icalendar import Calendar, Event as iEvent
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path
from pydantic import BaseModel
import os
import json
import hashlib
import requests
import asyncio
import uuid
import uvicorn


load_dotenv()

CIS_USER = os.getenv("CIS_USER")
CIS_PASS = os.getenv("CIS_PASS")

VIENNA = ZoneInfo("Europe/Vienna")
PULL_LOG_FILE = Path("pull_log.json")
CUSTOM_ICS_FILE = Path("custom.ics")

def load_pull_log():
    if PULL_LOG_FILE.exists():
        return json.loads(PULL_LOG_FILE.read_text())
    return []

def save_pull_log(log):
    PULL_LOG_FILE.write_text(json.dumps(log[-50:]))

def get_cache_hash():
    if Path("cache.ics").exists():
        return hashlib.md5(Path("cache.ics").read_bytes()).hexdigest()
    return None

def pull_and_log():
    old_hash = get_cache_hash()
    get_ical_cis()
    new_hash = get_cache_hash()
    log = load_pull_log()
    log.append({
        "time": datetime.now(VIENNA).isoformat(),
        "changed": old_hash != new_hash,
    })
    save_pull_log(log)

async def cache_loop():
    while True:
        try:
            pull_and_log()
            print("Cache refreshed")
        except Exception as e:
            print(f"Cache refresh failed: {e}")
        await asyncio.sleep(1800)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(cache_loop())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_range() -> tuple[int, int]:
    now = datetime.now(VIENNA)
    year = now.year
    if now.month >= 8:
        begin = datetime(year, 8, 1, tzinfo=VIENNA)
        end = datetime(year + 1, 2, 28, tzinfo=VIENNA)
    else:
        begin = datetime(year, 2, 1, tzinfo=VIENNA)
        end = datetime(year, 7, 31, 23, 59, 59, tzinfo=VIENNA)
    return int(begin.timestamp()), int(end.timestamp())

def get_ical_cis():
    begin, end = get_range()
    response = requests.get(f'https://cis.technikum-wien.at/cis/private/lvplan/stpl_kalender.php?type=student&pers_uid={CIS_USER}&begin={begin}&ende={end}&format=ical&version=2&target=ical',
                            auth=(CIS_USER, CIS_PASS),
                            headers={"User-Agent": "lvsync/1.0 (contact: if25b115@technikum-wien.at, https://github.com/Machsiim/lvsync)"})

    with open("cache.ics", "wb") as f:
        f.write(response.content)

def get_ical():
    with open("cache.ics") as f:
        return Calendar.from_ical(f.read())

def get_custom_cal():
    if CUSTOM_ICS_FILE.exists():
        with open(CUSTOM_ICS_FILE) as f:
            return Calendar.from_ical(f.read())
    cal = Calendar()
    cal.add("prodid", "-//lvsync custom//EN")
    cal.add("version", "2.0")
    return cal

def save_custom_cal(cal: Calendar):
    with open(CUSTOM_ICS_FILE, "wb") as f:
        f.write(cal.to_ical())

def get_json_events(from_ts: datetime, to_ts: datetime):
    cal = get_ical()
    events = []

    for event in cal.walk("VEVENT"):
        start = event.get("DTSTART").dt
        if from_ts <= start < to_ts:
            events.append({
                "summary": str(event.get("SUMMARY")),
                "class": str(event.get("DESCRIPTION")).split("\n")[0],
                "lecturer": str(event.get("DESCRIPTION")).split("\n")[1],
                "location": str(event.get("LOCATION", "")),
                "start": start.isoformat(),
                "end": event.get("DTEND").dt.isoformat(),
            })

    custom_cal = get_custom_cal()
    for event in custom_cal.walk("VEVENT"):
        start = event.get("DTSTART").dt
        if start.tzinfo is None:
            start = start.replace(tzinfo=VIENNA)
        if from_ts <= start < to_ts:
            end = event.get("DTEND").dt
            if end.tzinfo is None:
                end = end.replace(tzinfo=VIENNA)
            events.append({
                "summary": str(event.get("SUMMARY")),
                "location": str(event.get("LOCATION", "")),
                "start": start.isoformat(),
                "end": end.isoformat(),
                "uid": str(event.get("UID")),
                "custom": True,
            })

    return events


class CustomEventCreate(BaseModel):
    summary: str
    location: str = ""
    start: str
    end: str


@app.get("/events")
def get_events(from_ts: int, to_ts: int):
    global VIENNA
    return get_json_events(datetime.fromtimestamp(from_ts, tz=VIENNA), datetime.fromtimestamp(to_ts, tz=VIENNA))

@app.post("/custom-events")
def create_custom_event(body: CustomEventCreate):
    cal = get_custom_cal()
    ev = iEvent()
    uid = str(uuid.uuid4())
    ev.add("uid", uid)
    ev.add("summary", body.summary)
    ev.add("location", body.location)
    ev.add("dtstart", datetime.fromisoformat(body.start).astimezone(VIENNA))
    ev.add("dtend", datetime.fromisoformat(body.end).astimezone(VIENNA))
    ev.add("dtstamp", datetime.now(VIENNA))
    cal.add_component(ev)
    save_custom_cal(cal)
    return {"status": "ok", "uid": uid}

@app.delete("/custom-events/{uid}")
def delete_custom_event(uid: str):
    cal = get_custom_cal()
    new_cal = Calendar()
    for k, v in cal.items():
        if k != "VEVENT":
            new_cal.add(k, v)
    for event in cal.walk("VEVENT"):
        if str(event.get("UID")) != uid:
            new_cal.add_component(event)
    save_custom_cal(new_cal)
    return {"status": "ok"}

@app.get("/logs")
def get_logs():
    return load_pull_log()

@app.post("/refresh")
def refresh():
    pull_and_log()
    return {"status": "ok"}


CLIENT_DIR = Path(__file__).resolve().parent.parent / "lvsync.Client"
app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", port=6060, log_level="info")