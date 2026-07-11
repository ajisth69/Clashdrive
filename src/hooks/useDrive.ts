import { useState, useCallback, useRef } from "react";
import type { TelegramClient } from "telegram";
import { scanForDriveGroup, createDriveGroup } from "../lib/radar";
import { getTopics, createTopic, deleteTopic, renameTopic } from "../lib/topics";
import { ensureConnected } from "../lib/client";
import type { DriveConfig, TopicFolder } from "../types";

export function useDrive() {
  const [driveConfig, setDriveConfig] = useState<DriveConfig | null>(null);
  const [topics, setTopics] = useState<TopicFolder[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const topicsCache = useRef<Map<string, TopicFolder[]>>(new Map());

  /**
   * Run the full radar scan → drive setup → topic load pipeline.
   */
  const initDrive = useCallback(async (client: TelegramClient) => {
    setSyncing(true);
    setSyncStatus("Scanning your chats for an existing drive...");
    await ensureConnected();

    let config = await scanForDriveGroup(client);
    if (!config) {
      setSyncStatus("No drive found. Creating a new supergroup...");
      config = await createDriveGroup(client);
    }

    setDriveConfig(config);
    setSyncStatus("Loading folders...");

    let folders = await getTopics(client, config);

    const defaultTitles = ["Videos", "Audio", "Photos", "Documents"];
    for (const title of defaultTitles) {
      if (!folders.some((f) => f.title.toLowerCase() === title.toLowerCase())) {
        setSyncStatus(`Initializing ${title} folder...`);
        const topic = await createTopic(client, config, title);
        if (topic) {
          folders.push(topic);
        }
      }
    }

    setTopics(folders);
    topicsCache.current.set(config.chatId, folders);

    setSyncing(false);
    setSyncStatus("");
  }, []);

  /**
   * Refresh topics list from the network.
   */
  const refreshTopics = useCallback(
    async (client: TelegramClient) => {
      if (!driveConfig) return;
      await ensureConnected();
      const folders = await getTopics(client, driveConfig);
      setTopics(folders);
      topicsCache.current.set(driveConfig.chatId, folders);
    },
    [driveConfig]
  );

  /**
   * Create a new folder (topic).
   */
  const addFolder = useCallback(
    async (client: TelegramClient, name: string) => {
      if (!driveConfig) return;
      await ensureConnected();
      const topic = await createTopic(client, driveConfig, name);
      if (topic) {
        setTopics((prev) => [...prev, topic]);
      }
    },
    [driveConfig]
  );

  /**
   * Delete a folder (topic).
   */
  const removeFolder = useCallback(
    async (client: TelegramClient, topicId: number) => {
      if (!driveConfig) return;
      await ensureConnected();
      const ok = await deleteTopic(client, driveConfig, topicId);
      if (ok) {
        setTopics((prev) => prev.filter((t) => t.id !== topicId));
      }
    },
    [driveConfig]
  );

  const renameFolder = useCallback(
    async (client: TelegramClient, topicId: number, title: string) => {
      if (!driveConfig) return false;
      const nextTitle = title.trim();
      if (!nextTitle) return false;
      await ensureConnected();
      const ok = await renameTopic(client, driveConfig, topicId, nextTitle);
      if (ok) {
        setTopics((prev) =>
          prev.map((topic) =>
            topic.id === topicId ? { ...topic, title: nextTitle } : topic
          )
        );
        topicsCache.current.delete(driveConfig.chatId);
      }
      return ok;
    },
    [driveConfig]
  );

  /**
   * Client-side keyword filter over cached topics.
   */
  const filterTopics = useCallback(
    (query: string) => {
      if (!query.trim()) return topics;
      const q = query.toLowerCase();
      return topics.filter((t) => t.title.toLowerCase().includes(q));
    },
    [topics]
  );

  const resetDrive = useCallback(() => {
    setDriveConfig(null);
    setTopics([]);
    setSyncing(false);
    setSyncStatus("");
    topicsCache.current.clear();
  }, []);

  return {
    driveConfig,
    topics,
    syncing,
    syncStatus,
    initDrive,
    refreshTopics,
    addFolder,
    removeFolder,
    renameFolder,
    filterTopics,
    resetDrive,
  };
}
