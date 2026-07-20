import { TelegramClient, Api } from "telegram";
import bigInt from "big-integer";
import type { DriveConfig } from "../types";

export const BOT_USERNAME = "clashdrivebot";
export const BOT_ID = "8811426433";
export const DEFAULT_WORKER_URL = "https://clashdrive.clashgram.workers.dev";

export interface BotAdminStatus {
  success: boolean;
  message: string;
  isAdmin?: boolean;
}

/**
 * Automatically invite @clashdrivebot to user's Drive channel and promote it to Admin.
 */
export async function ensureBotIsAdmin(
  client: TelegramClient,
  config: DriveConfig
): Promise<BotAdminStatus> {
  if (!client || !config || !config.chatId) {
    return { success: false, message: "No active Telegram client or drive config." };
  }

  try {
    const channelPeer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash || "0"),
    });

    // 1. Resolve bot user entity
    let botUser: any = null;
    try {
      botUser = await client.getEntity(BOT_USERNAME);
    } catch {
      try {
        botUser = await client.getEntity(bigInt(BOT_ID));
      } catch {
        // Fallback search
        const res = await client.invoke(
          new Api.contacts.Search({ q: BOT_USERNAME, limit: 5 })
        );
        if (res.users && res.users.length > 0) {
          botUser = res.users[0];
        }
      }
    }

    if (!botUser) {
      return {
        success: false,
        message: `Could not locate Telegram bot @${BOT_USERNAME}. Please start the bot first.`,
      };
    }

    // 2. Invite bot to channel
    try {
      await client.invoke(
        new Api.channels.InviteToChannel({
          channel: channelPeer,
          users: [botUser],
        })
      );
    } catch (inviteErr: any) {
      // Ignore USER_ALREADY_PARTICIPANT or similar non-fatal errors
      const errStr = String(inviteErr);
      if (!errStr.includes("USER_ALREADY_PARTICIPANT")) {
        console.warn("Invite bot warning (continuing to promote):", inviteErr);
      }
    }

    // 3. Promote bot to Admin with necessary rights
    const adminRights = new Api.ChatAdminRights({
      changeInfo: true,
      postMessages: true,
      editMessages: true,
      deleteMessages: true,
      banUsers: false,
      inviteUsers: true,
      pinMessages: true,
      addAdmins: false,
      anonymous: false,
      manageCall: false,
      other: true,
      manageTopics: true,
    });

    await client.invoke(
      new Api.channels.EditAdmin({
        channel: channelPeer,
        userId: botUser,
        adminRights,
        rank: "File Sharing Bot",
      })
    );

    return {
      success: true,
      isAdmin: true,
      message: `@${BOT_USERNAME} successfully added and granted admin privileges!`,
    };
  } catch (err: any) {
    console.error("Failed to setup bot admin:", err);
    return {
      success: false,
      message: err?.message || `Failed to make @${BOT_USERNAME} an admin.`,
    };
  }
}
