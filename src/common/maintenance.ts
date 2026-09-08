const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export type JstDayOfWeek = (typeof WEEKDAYS)[number];

/** Integer hours in JST, with 0 <= startHour < endHour <= 23 (no overnight windows). */
export interface MaintenanceHours {
    readonly startHour: number;
    readonly endHour: number;
}

export interface MaintenanceWindow {
    readonly start: Date;
    readonly end: Date;
}

function jstDate(date: Date): Date {
    if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid maintenance reference date");
    return new Date(date.getTime() + JST_OFFSET_MS);
}

/** The actual JST weekday of the given instant, independent of maintenance hours. */
export function getJstDayOfWeek(date: Date = new Date()): JstDayOfWeek {
    return WEEKDAYS[jstDate(date).getUTCDay()];
}

function copyHours(hours: MaintenanceHours): MaintenanceHours {
    const { startHour, endHour } = hours;
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 23 || startHour >= endHour) {
        throw new RangeError("Maintenance hours must be integers satisfying 0 <= startHour < endHour <= 23");
    }
    return Object.freeze({ startHour, endHour });
}

/** A daily JST window, optionally replaced by different hours on specific weekdays. */
export class MaintenanceSchedule {
    private readonly daily: MaintenanceHours;
    private readonly overrides: Readonly<Partial<Record<JstDayOfWeek, MaintenanceHours>>>;

    constructor(daily: MaintenanceHours, overrides: Partial<Record<JstDayOfWeek, MaintenanceHours>> = {}) {
        this.daily = copyHours(daily);
        const copied: Partial<Record<JstDayOfWeek, MaintenanceHours>> = {};
        for (const day of WEEKDAYS) {
            const hours = overrides[day];
            if (hours !== undefined) copied[day] = copyHours(hours);
        }
        this.overrides = Object.freeze(copied);
    }

    /** Window on the reference instant's JST calendar date, even if it has ended. */
    public getWindowForDate(date: Date = new Date()): MaintenanceWindow {
        const shifted = jstDate(date);
        const hours = this.overrides[WEEKDAYS[shifted.getUTCDay()]] ?? this.daily;
        shifted.setUTCHours(0, 0, 0, 0);
        const midnight = shifted.getTime() - JST_OFFSET_MS;
        return {
            start: new Date(midnight + hours.startHour * HOUR_MS),
            end: new Date(midnight + hours.endHour * HOUR_MS),
        };
    }

    /** Active window, including its start and excluding its end; otherwise undefined. */
    public getCurrentWindow(now: Date = new Date()): MaintenanceWindow | undefined {
        const window = this.getWindowForDate(now);
        return now >= window.start && now < window.end ? window : undefined;
    }

    public isMaintenance(now: Date = new Date()): boolean {
        return this.getCurrentWindow(now) !== undefined;
    }

    /** Next window whose start is strictly after now; skips an active window. */
    public getNextWindow(now: Date = new Date()): MaintenanceWindow {
        const window = this.getWindowForDate(now);
        return now < window.start ? window : this.getWindowForDate(new Date(now.getTime() + DAY_MS));
    }

    /** Active window if any, otherwise the next window. Both endpoints share one JST date. */
    public getCurrentOrNextWindow(now: Date = new Date()): MaintenanceWindow {
        return this.getCurrentWindow(now) ?? this.getNextWindow(now);
    }
}

export const ALL_NET_MAINTENANCE = new MaintenanceSchedule({ startHour: 4, endHour: 7 });
export const CHUNITHM_MAINTENANCE = new MaintenanceSchedule({ startHour: 2, endHour: 7 });
export const MAIMAIDX_ENG_MAINTENANCE = new MaintenanceSchedule({ startHour: 1, endHour: 2 }, { wednesday: { startHour: 1, endHour: 4 } });
