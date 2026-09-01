const TIME_ZONE = "Asia/Tokyo";
const JST_UTC_OFFSET = "+09:00";

const MAINTENANCE_START_HOUR = 4;
const MAINTENANCE_END_HOUR = 7;

function nextMaintenanceDate(endHour: number): string {
    const offset = currentJstHour() >= endHour ? 86400 * 1000 : 0;
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
export function currentJstDayOfWeek() {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        weekday: "long",
    }).format(new Date());
}

function getJstHour(hour: number, endHour: number): Date {
    const time = `${String(hour).padStart(2, "0")}:00:00`;
    return new Date(`${nextMaintenanceDate(endHour)}T${time}${JST_UTC_OFFSET}`);
}

/**
 * @param startHour Maintenance start hour in JST. Defaults to the ALL.Net-wide
 * 04:00; CHUNITHM-NET maintenance starts earlier at 02:00.
 */
export function isAllNetMaintenance(startHour: number = MAINTENANCE_START_HOUR, endHour: number = MAINTENANCE_END_HOUR): boolean {
    const hour = currentJstHour();
    return hour >= startHour && hour < endHour;
}

export function getCurrentMaintenanceStartTime(startHour: number = MAINTENANCE_START_HOUR, endHour: number = MAINTENANCE_END_HOUR): Date {
    return getJstHour(startHour, endHour);
}

export function getCurrentMaintenanceEndTime(endHour: number = MAINTENANCE_END_HOUR): Date {
    return getJstHour(endHour, endHour);
}
