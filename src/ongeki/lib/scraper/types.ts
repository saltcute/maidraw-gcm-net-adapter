import type { Chart } from "gcm-database-otogedb/ongeki";

export interface WorkingChart {
    name: string;
    level: string;
    difficulty: string;
    dbChart?: Chart;
}
export interface NetScore extends WorkingChart {
    rank: string;
    combo: string;
    bell: string;
    score: number;
    platinumScore: number;
    maxPlatinumScore: number;
}
export interface RecentScore {
    name: string;
    difficulty: string;
    score: number;
    rank: string;
    combo: string;
    bell: string;
}
