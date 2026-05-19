import { TelegramClient, Api } from "telegram";
import {
  DRIVE_SIGNATURE,
  DEFAULT_DRIVE_TITLE,
  LS_DRIVE,
} from "../config/telegram";
import type { DriveConfig } from "../types";
import bigInt from "big-integer";

async function verifyDriveGroup(
  client: TelegramClient,
  config: DriveConfig
): Promise<DriveConfig | null> {
  try {
    const channel = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel })
    );
    const about = (full.fullChat as Api.ChannelFull).about ?? "";
    return about.includes(DRIVE_SIGNATURE) ? config : null;
  } catch {
    return null;
  }
}

/**
 * Scan the user's dialogs looking for a group whose description contains
 * the drive signature hashtag. Returns the config if found, null otherwise.
 */
export async function scanForDriveGroup(
  client: TelegramClient
): Promise<DriveConfig | null> {
  // Check sessionStorage first
  const cached = sessionStorage.getItem(LS_DRIVE);
  if (cached) {
    try {
      const config = JSON.parse(cached) as DriveConfig;
      if (config.accessHash) {
        const verified = await verifyDriveGroup(client, config);
        if (verified) return verified;
        sessionStorage.removeItem(LS_DRIVE);
      }
    } catch {
      sessionStorage.removeItem(LS_DRIVE);
    }
  }

  const dialogs = await client.getDialogs({ limit: 200 });

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity) continue;

    // We only care about channels / supergroups
    if (entity.className !== "Channel") continue;
    const channel = entity as Api.Channel;

    // Pull full info to read the "about" field
    try {
      const full = await client.invoke(
        new Api.channels.GetFullChannel({ channel })
      );
      const about = (full.fullChat as Api.ChannelFull).about ?? "";
      if (about.includes(DRIVE_SIGNATURE)) {
        const config: DriveConfig = {
          chatId: channel.id.toString(),
          chatTitle: channel.title,
          accessHash: channel.accessHash ? channel.accessHash.toString() : "0",
        };
        sessionStorage.setItem(LS_DRIVE, JSON.stringify(config));
        return config;
      }
    } catch {
      // Permission errors, skip
      continue;
    }
  }

  return null;
}

/**
 * Create a new drive supergroup with forum topics enabled.
 */
export async function createDriveGroup(
  client: TelegramClient
): Promise<DriveConfig> {
  // @ts-ignore — GramJS accepts `forum` at runtime to enable topics
  const result = await client.invoke(
    new Api.channels.CreateChannel({
      title: DEFAULT_DRIVE_TITLE,
      about: `Personal cloud storage powered by Telegram.\n${DRIVE_SIGNATURE}`,
      megagroup: true,
      forum: true,
    })
  );

  const chats = (result as Api.Updates).chats;
  const channel = chats[0] as Api.Channel;

  const config: DriveConfig = {
    chatId: channel.id.toString(),
    chatTitle: channel.title,
    accessHash: channel.accessHash ? channel.accessHash.toString() : "0",
  };
  sessionStorage.setItem(LS_DRIVE, JSON.stringify(config));

  return config;
}
