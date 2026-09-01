import { BaseError } from "maidraw";
import { getCurrentMaintenanceEndTime, getCurrentMaintenanceStartTime } from "./maintenance";
import { getRelativeTime } from "./relativeTime";

export class BaseGcmError extends BaseError {
    constructor(type: string, message: string) {
        super("maidraw.adapter.gcm-net", type, message);
    }
}

const servicesMap = {
    default: "maimaiでらっくすNET, CHUNITHM-NET, or オンゲキ-NET",
    "maimaidx-eng": "maimai DX NET",
    chunithm: "CHUNITHM-NET",
};
export class AllNetMaintenanceError extends BaseGcmError {
    constructor(startHour: number = 4, endHour: number = 7, service: "default" | "maimaidx-eng" | "chunithm" = "default") {
        super(
            "maintenance",
            `The ALL.Net service is currently under scheduled maintenance. You cannot use ALL.Net services, including ${servicesMap[service]}, during the maintenance.

The maintenance period starts at ${String(startHour).padStart(2, "0")}:00 JST (${getRelativeTime(getCurrentMaintenanceStartTime(startHour))}) and ends at ${String(endHour).padStart(2, "0")}:00 JST (${getRelativeTime(getCurrentMaintenanceEndTime())}).`,
        );
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
