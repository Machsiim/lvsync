from dotenv import load_dotenv
from icalendar import Calendar
from datetime import datetime
from zoneinfo import ZoneInfo
import os
import requests


load_dotenv()

USERNAME = os.getenv("USERNAME")
PASSWORD = os.getenv("PASSWORD")

VIENNA = ZoneInfo("Europe/Vienna")

def get_ical():
    response = requests.get('https://cis.technikum-wien.at/cis/private/lvplan/stpl_kalender.php?type=student&pers_uid=if25b115&begin=1770159600&ende=1785535200&format=ical&version=2&target=ical', auth=(USERNAME, PASSWORD))
    cal = Calendar.from_ical(response.content)
    return cal

def get_json_events(from_ts: datetime, to_ts: datetime):
    
    cal = get_ical()
    
    for event in cal.walk("VEVENT"):
        start = event.get("DTSTART").dt

        if from_ts <= start < to_ts:
            summary = str(event.get("SUMMARY"))
            print(summary)
            

from_ts = datetime(2026, 4, 20, 0, 0, tzinfo=VIENNA)
to_ts = datetime(2026, 4, 26, 0, 0, tzinfo=VIENNA)

get_json_events(from_ts, to_ts)



