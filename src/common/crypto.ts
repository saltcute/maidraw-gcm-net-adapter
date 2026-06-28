import os from "node:os";
import type Kasumi from "kasumi.js";

interface KasumiConfig {
    "maidraw-gcm-net-adapter:auth.pgpkey"?: {
        key: {
            privateKey: string;
            passphrase: string;
            publicKey: string;
        };
        expire: number;
    };
}

export class Crypto {
    public static global?: Crypto;

    private pgpKey!: {
        privateKey: string;
        passphrase: string;
        publicKey: string;
    };
    private constructor(
        private kasumi: Kasumi<KasumiConfig>,
        PgpKey?: {
            privateKey: string;
            passphrase: string;
            publicKey?: string;
        },
    ) {
        if (PgpKey)
            this.pgpKey = {
                privateKey: PgpKey.privateKey,
                passphrase: PgpKey.passphrase,
                publicKey: PgpKey.publicKey || "",
            };
    }

    private async init() {
        const openpgp = await import("openpgp");
        if (!this.pgpKey) {
            const key = await this.kasumi.config.getOne("maidraw-gcm-net-adapter:auth.pgpkey");
            if (key && Date.now() < key.expire) {
                this.pgpKey = key.key;
            } else {
                const passphrase = os.hostname();
                const { privateKey, publicKey } = await openpgp.generateKey({
                    // biome-ignore lint/style/useNamingConvention: openpgp naming convention
                    userIDs: {
                        name: "maidraw-gcm-net-adapter",
                        email: "salt@example.com",
                    },
                    passphrase,
                    format: "armored",
                });
                this.pgpKey = {
                    publicKey,
                    privateKey,
                    passphrase,
                };
                this.kasumi.config.set("maidraw-gcm-net-adapter:auth.pgpkey", {
                    key: this.pgpKey,
                    expire: Date.now() + 30 * 24 * 60 * 60 * 1000,
                });
                await this.kasumi.config.syncEssential();
            }
        } else {
            if (!this.pgpKey.publicKey) {
                const privateKey = await openpgp.readPrivateKey({
                    armoredKey: this.pgpKey.privateKey,
                });
                const publicKey = privateKey.toPublic();
                this.pgpKey.publicKey = publicKey.armor();
            }
        }
    }

    public getPublicKey() {
        return this.pgpKey.publicKey;
    }

    public async encrypt(payload: Record<string, string>) {
        const openpgp = await import("openpgp");
        const publicKey = await openpgp.readKey({
            armoredKey: this.pgpKey.publicKey,
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
                    armoredKey: this.pgpKey.privateKey,
                }),
                passphrase: this.pgpKey.passphrase,
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
        this.kasumi.config.set("maidraw-gcm-net-adapter:auth.gpgkey", undefined);
    }

    public static async new(kasumi: Kasumi, PgpKey?: { privateKey: string; passphrase: string; publicKey?: string }) {
        const instance = new Crypto(kasumi, PgpKey);
        await instance.init();
        return instance;
    }
}
