import React, { useEffect, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { router } from "expo-router";

import { supabase } from "../lib/supabase";

type NotificationItem = {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationsScreen() {
  const [notifications, setNotifications] =
    useState<NotificationItem[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  useEffect(() => {
    loadNotifications();

    let channel:
      ReturnType<typeof supabase.channel> | null =
      null;

    async function setupRealtime() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      channel = supabase
        .channel(
          `notifications-${user.id}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            loadNotifications();
          }
        )
        .subscribe();
    }

    setupRealtime();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  async function loadNotifications() {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "User session not found."
        );
      }

      const {
        data,
        error,
      } = await supabase
        .from("notifications")
        .select(
          `
          id,
          notification_type,
          title,
          message,
          reference_id,
          reference_type,
          is_read,
          created_at
          `
        )
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      setNotifications(
        (data as NotificationItem[]) || []
      );
    } catch (error: any) {
      console.error(
        "LOAD NOTIFICATIONS ERROR:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to load notifications."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function markAsRead(
    notification: NotificationItem
  ) {
    if (notification.is_read) {
      return;
    }

    try {
      const { error } =
        await supabase
          .from("notifications")
          .update({
            is_read: true,
          })
          .eq(
            "id",
            notification.id
          );

      if (error) {
        throw error;
      }

      setNotifications(
        (current) =>
          current.map((item) =>
            item.id ===
            notification.id
              ? {
                  ...item,
                  is_read: true,
                }
              : item
          )
      );
    } catch (error: any) {
      console.error(
        "MARK NOTIFICATION READ ERROR:",
        error
      );
    }
  }

  async function markAllAsRead() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const { error } =
        await supabase
          .from("notifications")
          .update({
            is_read: true,
          })
          .eq("user_id", user.id)
          .eq("is_read", false);

      if (error) {
        throw error;
      }

      setNotifications(
        (current) =>
          current.map((item) => ({
            ...item,
            is_read: true,
          }))
      );
    } catch (error: any) {
      console.error(
        "MARK ALL READ ERROR:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to mark notifications as read."
      );
    }
  }

  async function refresh() {
    setRefreshing(true);
    await loadNotifications();
  }

  function formatTime(
    dateString: string
  ) {
    const date =
      new Date(dateString);

    return date.toLocaleString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  function getNotificationStyle(
    type: string
  ) {
    if (
      type.includes("ASSIGN") ||
      type.includes("REQUEST")
    ) {
      return styles.assignmentIcon;
    }

    if (
      type.includes("VERIF") ||
      type.includes("COMPLETE")
    ) {
      return styles.successIcon;
    }

    if (
      type.includes("REJECT") ||
      type.includes("FAIL") ||
      type.includes("EXCEPTION")
    ) {
      return styles.warningIcon;
    }

    return styles.defaultIcon;
  }

  const unreadCount =
    notifications.filter(
      (item) => !item.is_read
    ).length;

  return (
    <SafeAreaView
      style={styles.container}
    >
      {/* HEADER */}

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text
            style={styles.backText}
          >
            ←
          </Text>
        </TouchableOpacity>

        <View
          style={styles.headerTitleContainer}
        >
          <Text
            style={styles.headerTitle}
          >
            Notifications
          </Text>

          <Text
            style={styles.headerSubtitle}
          >
            {unreadCount > 0
              ? `${unreadCount} unread notification${
                  unreadCount !== 1
                    ? "s"
                    : ""
                }`
              : "You're all caught up"}
          </Text>
        </View>

        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={
              markAllAsRead
            }
          >
            <Text
              style={
                styles.markAllText
              }
            >
              Mark all read
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* CONTENT */}

      {loading ? (
        <View
          style={styles.loadingContainer}
        >
          <ActivityIndicator
            size="large"
          />

          <Text
            style={styles.loadingText}
          >
            Loading notifications...
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={
            styles.content
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
            />
          }
          showsVerticalScrollIndicator={
            false
          }
        >
          {notifications.length ===
          0 ? (
            <View
              style={styles.emptyCard}
            >
              <Text
                style={styles.emptyIcon}
              >
                ✓
              </Text>

              <Text
                style={styles.emptyTitle}
              >
                No Notifications
              </Text>

              <Text
                style={styles.emptyText}
              >
                New service assignments,
                request updates, and
                verification messages
                will appear here.
              </Text>
            </View>
          ) : (
            notifications.map(
              (notification) => (
                <TouchableOpacity
                  key={
                    notification.id
                  }
                  style={[
                    styles.notificationCard,
                    !notification.is_read &&
                      styles.unreadCard,
                  ]}
                  activeOpacity={0.8}
                  onPress={() =>
                    markAsRead(
                      notification
                    )
                  }
                >
                  <View
                    style={[
                      styles.notificationIcon,
                      getNotificationStyle(
                        notification.notification_type
                      ),
                    ]}
                  >
                    <Text
                      style={
                        styles.notificationIconText
                      }
                    >
                      !
                    </Text>
                  </View>

                  <View
                    style={
                      styles.notificationContent
                    }
                  >
                    <View
                      style={
                        styles.notificationTopRow
                      }
                    >
                      <Text
                        style={
                          styles.notificationTitle
                        }
                        numberOfLines={
                          2
                        }
                      >
                        {
                          notification.title
                        }
                      </Text>

                      {!notification.is_read && (
                        <View
                          style={
                            styles.unreadDot
                          }
                        />
                      )}
                    </View>

                    <Text
                      style={
                        styles.notificationMessage
                      }
                    >
                      {
                        notification.message
                      }
                    </Text>

                    <Text
                      style={
                        styles.notificationTime
                      }
                    >
                      {formatTime(
                        notification.created_at
                      )}
                    </Text>
                  </View>
                </TouchableOpacity>
              )
            )
          )}

          <View
            style={styles.bottomSpace}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },

  header: {
    minHeight: 82,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },

  backText: {
    fontSize: 25,
    color: "#111827",
    marginTop: -2,
  },

  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },

  headerTitle: {
    fontSize: 21,
    fontWeight: "800",
    color: "#111827",
  },

  headerSubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: "#6b7280",
  },

  markAllButton: {
    paddingHorizontal: 8,
    paddingVertical: 7,
  },

  markAllText: {
    color: "#2563eb",
    fontSize: 11,
    fontWeight: "700",
  },

  content: {
    padding: 16,
  },

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginTop: 10,
    color: "#6b7280",
    fontSize: 13,
  },

  notificationCard: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  unreadCard: {
    borderColor: "#bfdbfe",
    backgroundColor: "#f8fbff",
  },

  notificationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  assignmentIcon: {
    backgroundColor: "#dbeafe",
  },

  successIcon: {
    backgroundColor: "#dcfce7",
  },

  warningIcon: {
    backgroundColor: "#fee2e2",
  },

  defaultIcon: {
    backgroundColor: "#e5e7eb",
  },

  notificationIconText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#374151",
  },

  notificationContent: {
    flex: 1,
    marginLeft: 12,
  },

  notificationTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  notificationTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    color: "#111827",
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563eb",
    marginLeft: 8,
    marginTop: 5,
  },

  notificationMessage: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: "#6b7280",
  },

  notificationTime: {
    marginTop: 8,
    fontSize: 10,
    color: "#9ca3af",
  },

  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 35,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginTop: 20,
  },

  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#dcfce7",
    color: "#15803d",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 26,
    fontWeight: "800",
    overflow: "hidden",
  },

  emptyTitle: {
    marginTop: 15,
    fontSize: 18,
    fontWeight: "800",
    color: "#374151",
  },

  emptyText: {
    marginTop: 7,
    fontSize: 12,
    lineHeight: 18,
    color: "#9ca3af",
    textAlign: "center",
  },

  bottomSpace: {
    height: 30,
  },
});