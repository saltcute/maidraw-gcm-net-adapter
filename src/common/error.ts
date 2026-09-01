import { BaseError } from "maidraw";
import { getCurrentMaintenanceEndTime, getCurrentMaintenanceStartTime } from "./maintenance";
import { getRelativeTime } from "./relativeTime";

export class BaseGcmError extends BaseError {
    constructor(type: string, message: string) {
        super("maidraw.adapter.gcm-net", type, message);
    }
}

export class AllNetMaintenanceError extends BaseGcmError {
    private static readonly servicesMap = {
        default: "maimaiでらっくすNET, CHUNITHM-NET, or オンゲキ-NET",
        "maimaidx-eng": "maimai DX NET",
        chunithm: "CHUNITHM-NET",
    };
    constructor(
        private startHour: number = 4,
        private endHour: number = 7,
        private service: "default" | "maimaidx-eng" | "chunithm" = "default",
    ) {
        super(
            "maintenance",
            `The ALL.Net service is currently under scheduled maintenance. You cannot use ALL.Net services, including ${AllNetMaintenanceError.servicesMap[service]}, during the maintenance.

The maintenance period started at ${String(startHour).padStart(2, "0")}:00 JST (${getRelativeTime(getCurrentMaintenanceStartTime(startHour))}) and will end at ${String(endHour).padStart(2, "0")}:00 JST (${getRelativeTime(getCurrentMaintenanceEndTime(endHour))}).`,
        );
    }
    public getDiscordMarkdownContent() {
        const startTimestamp = Math.floor(getCurrentMaintenanceStartTime(this.startHour).getTime() / 1000);
        const endTimestamp = Math.floor(getCurrentMaintenanceEndTime(this.endHour).getTime() / 1000);
        return `The ALL.Net service is currently under scheduled maintenance. You cannot use ALL.Net services, including ${AllNetMaintenanceError.servicesMap[this.service]}, during the maintenance. 

The maintenance period started at <t:${startTimestamp}:t> (<t:${startTimestamp}:R>), and will end at <t:${endTimestamp}:t> (<t:${endTimestamp}:R>).`;
    }
}

export class UnknownError extends BaseGcmError {
    constructor(detail?: string) {
        super("unknown", `An unknown error has occurred.${detail && ` More info: ${detail}`}`);
    }
}

export class FailedToDecryptError extends BaseGcmError {
    constructor() {
        super("failed-to-decrypt", "Decryption failed");
    }
}

export class FailedToAuthenticateError extends BaseGcmError {
    constructor() {
        super("failed-to-authenticate", "Failed to authenticate using provided credentials");
    }
}
