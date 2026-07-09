// Source - https://stackoverflow.com/a/53800501
// Posted by vsync, modified by community. See post 'Timeline' for change history
// Retrieved 2026-07-10, License - CC BY-SA 4.0

// in miliseconds
const timeUnits = {
    year: 24 * 60 * 60 * 1000 * 365,
    month: (24 * 60 * 60 * 1000 * 365) / 12,
    day: 24 * 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    minute: 60 * 1000,
    second: 1000,
} as const;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function getRelativeTime(d1: Date, d2: Date = new Date()) {
    var elapsed = d1.getTime() - d2.getTime();

    // "Math.abs" accounts for both "past" & "future" scenarios
    for (const u of Object.keys(timeUnits) as (keyof typeof timeUnits)[])
        if (Math.abs(elapsed) > timeUnits[u] || u === "second") return rtf.format(Math.round(elapsed / timeUnits[u]), u);
}
