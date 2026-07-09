import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os, { homedir } from "node:os";
import { join } from "node:path";
import openpgp from "openpgp";

export class Crypto {
    public static global?: Crypto;

    privateKey!: string;
    publicKey!: string;
    passphrase!: string;
    private constructor(privateKey?: string, passphrase?: string, publicKey?: string) {
        if (privateKey) this.privateKey = privateKey;
        if (passphrase) this.passphrase = passphrase;
        if (publicKey) this.publicKey = publicKey;
    }

    private readonly keyPath = join(homedir(), ".config", "maidraw", "gcm-net-adapter", "pgpkey");
    private readonly privateKeyPath = join(this.keyPath, "private.asc");
    private readonly passphrasePath = join(this.keyPath, "passphrase.txt");
    private async init() {
        if (!this.privateKey) {
            if (existsSync(this.privateKeyPath) && existsSync(this.passphrasePath)) {
                const privateKey = readFileSync(this.privateKeyPath, { encoding: "utf-8" });
                const passphrase = readFileSync(this.passphrasePath, { encoding: "utf-8" });
                this.privateKey = privateKey;
                this.passphrase = passphrase;
                const privateKeyInstance = await openpgp.readPrivateKey({
                    armoredKey: this.privateKey,
                });
                const publicKey = privateKeyInstance.toPublic();
                this.publicKey = publicKey.armor();
            } else {
                const passphrase = this.passphrase || os.hostname();
                const { privateKey, publicKey } = await openpgp.generateKey({
                    // biome-ignore lint/style/useNamingConvention: openpgp naming convention
                    userIDs: {
                        name: "maidraw-gcm-net-adapter",
                        email: "salt@example.com",
                    },
                    passphrase,
                    format: "armored",
                });
                this.passphrase = passphrase;
                this.privateKey = privateKey;
                this.publicKey = publicKey;

                mkdirSync(this.keyPath, { recursive: true });
                writeFileSync(this.privateKeyPath, privateKey);
                writeFileSync(this.passphrasePath, passphrase);
            }
        } else {
            if (!this.publicKey) {
                const privateKey = await openpgp.readPrivateKey({
                    armoredKey: this.privateKey,
                });
                const publicKey = privateKey.toPublic();
                this.publicKey = publicKey.armor();
            }
        }
    }

    public getPublicKey() {
        return this.publicKey;
    }

    public async encrypt(payload: Record<string, string>) {
        const openpgp = await import("openpgp");
        const publicKey = await openpgp.readKey({
            armoredKey: this.publicKey,
        });
        const encrypted = await openpgp.encrypt({
            message: await openpgp.createMessage({
                text: JSON.stringify(payload),
            }),
            encryptionKeys: publicKey,
            format: "armored",
        });
        return encrypted;
    }

    public async decrypt(encrypted: string) {
        try {
            const openpgp = await import("openpgp");
            const privateKey = await openpgp.decryptKey({
                privateKey: await openpgp.readPrivateKey({
                    armoredKey: this.privateKey,
                }),
                passphrase: this.passphrase,
            });
            const message = await openpgp.readMessage({
                armoredMessage: encrypted,
            });
            const { data: decrypted } = await openpgp.decrypt({
                message,
                decryptionKeys: privateKey,
            });
            return JSON.parse(decrypted as string) as Record<string, string>;
        } catch {
            return null;
        }
    }

    public resetStoredKey() {
        unlinkSync(this.privateKeyPath);
        unlinkSync(this.passphrasePath);
    }

    public static async new(privateKey?: string, passphrase?: string, publicKey?: string) {
        const instance = new Crypto(privateKey, passphrase, publicKey);
        await instance.init();
        return instance;
    }
}
