const TIME_ZONE = "Asia/Tokyo";
const JST_UTC_OFFSET = "+09:00";

const MAINTENANCE_START_HOUR = 4;
const MAINTENANCE_END_HOUR = 7;

function nextMaintenanceDate(): string {
    const offset = currentJstHour() >= 7 ? 86400 : 0;
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(Date.now() + offset));
}

function currentJstHour(): number {
    return Number(
        new Intl.DateTimeFormat("en-US", {
            timeZone: TIME_ZONE,
            hour: "2-digit",
            hourCycle: "h23",
        }).format(new Date()),
    );
}

function getJstHour(hour: number): Date {
    const time = `${String(hour).padStart(2, "0")}:00:00`;
    return new Date(`${nextMaintenanceDate()}T${time}${JST_UTC_OFFSET}`);
}

export function isAllNetMaintenance(): boolean {
    const hour = currentJstHour();
    return hour >= MAINTENANCE_START_HOUR && hour < MAINTENANCE_END_HOUR;
}

export function getCurrentMaintenanceStartTime(): Date {
    return getJstHour(MAINTENANCE_START_HOUR);
}

export function getCurrentMaintenanceEndTime(): Date {
    return getJstHour(MAINTENANCE_END_HOUR);
}
