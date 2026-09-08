import { MAIMAIDX_ENG_MAINTENANCE, type MaintenanceSchedule } from "@common/maintenance";
import type { Database } from "gcm-database-otogedb/maimai";
import { MaimaiDxNetEngScraper } from "./lib/scraper/maimaidx-eng";
import { MaimaiDxNetAdapter } from "./maimaidx-net";

export class MaimaiDxNetEngAdapter extends MaimaiDxNetAdapter {
    protected scraper = new MaimaiDxNetEngScraper();

    public readonly maintenanceSchedule: MaintenanceSchedule = MAIMAIDX_ENG_MAINTENANCE;
    protected readonly maintenanceService: "default" | "maimaidx-eng" | "chunithm" = "maimaidx-eng";

    constructor({
        name = "maimaidx-net-eng-adapter",
        database,
    }: {
        name?: string;
        database: Database;
    }) {
        super({ name, database });
    }
}
