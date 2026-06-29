import type { Chart } from "gcm-database-otogedb/maimai";

export interface WorkingChart {
    name: string;
    level: string;
    difficulty: string;
    mode: string;
    dbChart?: Chart;
}
export interface NetScore extends WorkingChart {
    sync: string;
    combo: string;
    achievement: string;
    score: number;
    dxScore: number;
    maxDxScore: number;
}
