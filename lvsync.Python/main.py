from dotenv import load_dotenv
from icalendar import Calendar
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os
import requests
import uvicorn


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

load_dotenv()

USERNAME = os.getenv("USERNAME")
PASSWORD = os.getenv("PASSWORD")

VIENNA = ZoneInfo("Europe/Vienna")

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
    response = requests.get(f'https://cis.technikum-wien.at/cis/private/lvplan/stpl_kalender.php?type=student&pers_uid=if25b115&begin={begin}&ende={end}&format=ical&version=2&target=ical', auth=(USERNAME, PASSWORD))
    with open("cache.ics", "wb") as f:
        f.write(response.content)

def get_ical():
    with open("cache.ics") as f:
        return Calendar.from_ical(f.read())

def manual_cache_refresh():
    get_ical_cis()

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

    return events

                

@app.get("/events")
def get_events(from_ts: int, to_ts: int):
    global VIENNA
    print(get_json_events(datetime.fromtimestamp(from_ts, tz=VIENNA), datetime.fromtimestamp(to_ts, tz=VIENNA)))
    return get_json_events(datetime.fromtimestamp(from_ts, tz=VIENNA), datetime.fromtimestamp(to_ts, tz=VIENNA))


CLIENT_DIR = Path(__file__).resolve().parent.parent / "lvsync.Client"
app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", port=6060, log_level="info")