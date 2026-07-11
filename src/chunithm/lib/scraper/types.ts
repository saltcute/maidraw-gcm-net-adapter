import type { Chart } from "gcm-database-otogedb/chunithm";

export interface WorkingChart {
    name: string;
    difficulty: string;
    dbChart?: Chart;
}
export interface NetScore extends WorkingChart {
    clear: string;
    combo: string;
    chain: string;
    score: number;
}
