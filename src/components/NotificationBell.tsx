import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { supabase } from "../lib/supabase";

type Notification = {
  id: string;
  user_id: string;
  notification_type: string;
  title: string;
  message: string;
  reference_id: string | null;
  reference_type: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationBell() {
  const [notifications, setNotifications] =
    useState<Notification[]>([]);

  const [showNotifications, setShowNotifications] =
    useState(false);

  const [toastNotification, setToastNotification] =
    useState<Notification | null>(null);

  const [toastVisible, setToastVisible] =
    useState(false);

  const [unreadCount, setUnreadCount] =
    useState(0);

  const toastAnimation = useRef(
    new Animated.Value(-180)
  ).current;

  const toastOpacity = useRef(
    new Animated.Value(0)
  ).current;

  const toastTimer = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  useEffect(() => {
    initializeNotifications();

    return () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }

      supabase.removeChannel(
        supabase.channel("notification-bell")
      );
    };
  }, []);

  async function initializeNotifications() {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error(
          "NOTIFICATION USER ERROR:",
          userError
        );
        return;
      }

      if (!user) {
        return;
      }

      await loadNotifications(user.id);

      subscribeToNotifications(user.id);
    } catch (error) {
      console.error(
        "NOTIFICATION INITIALIZATION ERROR:",
        error
      );
    }
  }

  async function loadNotifications(
    userId: string
  ) {
    try {
      const {
        data,
        error,
      } = await supabase
        .from("notifications")
        .select(
          `
          id,
          user_id,
          notification_type,
          title,
          message,
          reference_id,
          reference_type,
          is_read,
          created_at
          `
        )
        .eq("user_id", userId)
        .order("created_at", {
          ascending: false,
        })
        .limit(20);

      if (error) {
        console.error(
          "LOAD NOTIFICATIONS ERROR:",
          error
        );
        return;
      }

      const notificationList =
        (data || []) as Notification[];

      setNotifications(
        notificationList
      );

      setUnreadCount(
        notificationList.filter(
          (notification) =>
            !notification.is_read
        ).length
      );
    } catch (error) {
      console.error(
        "NOTIFICATION LOAD ERROR:",
        error
      );
    }
  }

  function subscribeToNotifications(
    userId: string
  ) {
    const channel = supabase
      .channel("notification-bell")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          console.log(
            "NEW NOTIFICATION:",
            payload
          );

          const newNotification =
            payload.new as Notification;

          setNotifications(
            (previous) => [
              newNotification,
              ...previous,
            ].slice(0, 20)
          );

          setUnreadCount(
            (previous) => previous + 1
          );

          showFloatingNotification(
            newNotification
          );
        }
      )
      .subscribe((status) => {
        console.log(
          "NOTIFICATION REALTIME:",
          status
        );
      });

    return channel;
  }

  function showFloatingNotification(
    notification: Notification
  ) {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }

    setToastNotification(
      notification
    );

    setToastVisible(true);

    toastAnimation.setValue(-180);
    toastOpacity.setValue(0);

    Animated.parallel([
      Animated.timing(
        toastAnimation,
        {
          toValue: 0,
          duration: 350,
          easing:
            Easing.out(
              Easing.cubic
            ),
          useNativeDriver: true,
        }
      ),

      Animated.timing(
        toastOpacity,
        {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }
      ),
    ]).start();

    toastTimer.current =
      setTimeout(() => {
        hideFloatingNotification();
      }, 5000);
  }

  function hideFloatingNotification() {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }

    Animated.parallel([
      Animated.timing(
        toastAnimation,
        {
          toValue: -180,
          duration: 250,
          easing:
            Easing.in(
              Easing.cubic
            ),
          useNativeDriver: true,
        }
      ),

      Animated.timing(
        toastOpacity,
        {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }
      ),
    ]).start(() => {
      setToastVisible(false);
      setToastNotification(null);
    });
  }

  async function markAsRead(
    notification: Notification
  ) {
    if (notification.is_read) {
      return;
    }

    try {
      const {
        error,
      } = await supabase
        .from("notifications")
        .update({
          is_read: true,
        })
        .eq("id", notification.id);

      if (error) {
        console.error(
          "MARK NOTIFICATION READ ERROR:",
          error
        );
        return;
      }

      setNotifications(
        (previous) =>
          previous.map(
            (item) =>
              item.id ===
              notification.id
                ? {
                    ...item,
                    is_read: true,
                  }
                : item
          )
      );

      setUnreadCount(
        (previous) =>
          Math.max(0, previous - 1)
      );
    } catch (error) {
      console.error(
        "MARK READ ERROR:",
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

      const {
        error,
      } = await supabase
        .from("notifications")
        .update({
          is_read: true,
        })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) {
        console.error(
          "MARK ALL READ ERROR:",
          error
        );
        return;
      }

      setNotifications(
        (previous) =>
          previous.map(
            (notification) => ({
              ...notification,
              is_read: true,
            })
          )
      );

      setUnreadCount(0);
    } catch (error) {
      console.error(
        "MARK ALL READ ERROR:",
        error
      );
    }
  }

  function formatTime(
    dateString: string
  ) {
    const date =
      new Date(dateString);

    return date.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  function getNotificationIcon(
    type: string
  ) {
    switch (type) {
      case "VERIFICATION_REQUIRED":
        return "✓";

      case "REQUEST_VERIFIED":
        return "✓";

      case "ASSIGNMENT_CREATED":
        return "⚙";

      case "ASSIGNMENT_REASSIGNED":
        return "↻";

      case "SLA_EXCEEDED":
        return "⚠";

      case "EXCEPTION":
        return "⚠";

      default:
        return "🔔";
    }
  }

  return (
    <>
      <TouchableOpacity
        style={styles.bellButton}
        activeOpacity={0.8}
        onPress={() =>
          setShowNotifications(true)
        }
      >
        <Text style={styles.bellIcon}>
          🔔
        </Text>

        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unreadCount > 99
                ? "99+"
                : unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {toastVisible &&
        toastNotification && (
          <Modal
            transparent
            visible
            animationType="none"
            statusBarTranslucent
            onRequestClose={
              hideFloatingNotification
            }
          >
            <View
              style={
                styles.toastModalContainer
              }
              pointerEvents="box-none"
            >
              <Animated.View
                style={[
                  styles.toast,
                  {
                    transform: [
                      {
                        translateY:
                          toastAnimation,
                      },
                    ],
                    opacity:
                      toastOpacity,
                  },
                ]}
              >
                <View
                  style={
                    styles.toastIconContainer
                  }
                >
                  <Text
                    style={
                      styles.toastIcon
                    }
                  >
                    {getNotificationIcon(
                      toastNotification.notification_type
                    )}
                  </Text>
                </View>

                <View
                  style={
                    styles.toastContent
                  }
                >
                  <Text
                    style={
                      styles.toastTitle
                    }
                    numberOfLines={1}
                  >
                    {
                      toastNotification.title
                    }
                  </Text>

                  <Text
                    style={
                      styles.toastMessage
                    }
                    numberOfLines={2}
                  >
                    {
                      toastNotification.message
                    }
                  </Text>
                </View>

                <TouchableOpacity
                  style={
                    styles.toastClose
                  }
                  onPress={
                    hideFloatingNotification
                  }
                >
                  <Text
                    style={
                      styles.toastCloseText
                    }
                  >
                    ×
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          </Modal>
        )}

      <Modal
        transparent
        visible={showNotifications}
        animationType="fade"
        onRequestClose={() =>
          setShowNotifications(false)
        }
      >
        <Pressable
          style={styles.overlay}
          onPress={() =>
            setShowNotifications(false)
          }
        >
          <Pressable
            style={styles.notificationPanel}
            onPress={(event) =>
              event.stopPropagation()
            }
          >
            <View
              style={
                styles.panelHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.panelTitle
                  }
                >
                  Notifications
                </Text>

                {unreadCount > 0 && (
                  <Text
                    style={
                      styles.panelSubtitle
                    }
                  >
                    {unreadCount} unread
                    notification
                    {unreadCount !== 1
                      ? "s"
                      : ""}
                  </Text>
                )}
              </View>

              <TouchableOpacity
                onPress={
                  markAllAsRead
                }
              >
                <Text
                  style={
                    styles.markAll
                  }
                >
                  Mark all read
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={
                styles.notificationList
              }
              showsVerticalScrollIndicator={
                false
              }
            >
              {notifications.length ===
              0 ? (
                <View
                  style={
                    styles.emptyNotifications
                  }
                >
                  <Text
                    style={
                      styles.emptyIcon
                    }
                  >
                    🔔
                  </Text>

                  <Text
                    style={
                      styles.emptyTitle
                    }
                  >
                    No notifications
                  </Text>

                  <Text
                    style={
                      styles.emptyText
                    }
                  >
                    You are all caught up.
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
                        styles.notificationItem,
                        !notification.is_read &&
                          styles.unreadItem,
                      ]}
                      activeOpacity={0.8}
                      onPress={() =>
                        markAsRead(
                          notification
                        )
                      }
                    >
                      <View
                        style={
                          styles.itemIconContainer
                        }
                      >
                        <Text
                          style={
                            styles.itemIcon
                          }
                        >
                          {getNotificationIcon(
                            notification.notification_type
                          )}
                        </Text>
                      </View>

                      <View
                        style={
                          styles.itemContent
                        }
                      >
                        <View
                          style={
                            styles.itemTitleRow
                          }
                        >
                          <Text
                            style={
                              styles.itemTitle
                            }
                            numberOfLines={1}
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
                            styles.itemMessage
                          }
                          numberOfLines={3}
                        >
                          {
                            notification.message
                          }
                        </Text>

                        <Text
                          style={
                            styles.itemTime
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
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  bellIcon: {
    fontSize: 22,
  },

  badge: {
    position: "absolute",
    right: 1,
    top: 1,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
  },

  badgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "800",
  },

  toastModalContainer: {
    flex: 1,
    paddingTop: 52,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "flex-start",
  },

  toast: {
    width: "100%",
    maxWidth: 430,
    minHeight: 78,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",

    shadowColor: "#000000",
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 12,
  },

  toastIconContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },

  toastIcon: {
    fontSize: 22,
    color: "#166534",
  },

  toastContent: {
    flex: 1,
    paddingRight: 6,
  },

  toastTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
  },

  toastMessage: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 3,
    lineHeight: 17,
  },

  toastClose: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  toastCloseText: {
    fontSize: 24,
    color: "#9ca3af",
    fontWeight: "400",
  },

  overlay: {
    flex: 1,
    backgroundColor:
      "rgba(0,0,0,0.35)",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    paddingTop: 55,
    paddingRight: 12,
    paddingLeft: 12,
  },

  notificationPanel: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "75%",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    overflow: "hidden",

    shadowColor: "#000000",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 15,
  },

  panelHeader: {
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  panelTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
  },

  panelSubtitle: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },

  markAll: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563eb",
  },

  notificationList: {
    maxHeight: 520,
  },

  notificationItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },

  unreadItem: {
    backgroundColor: "#eff6ff",
  },

  itemIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },

  itemIcon: {
    fontSize: 18,
  },

  itemContent: {
    flex: 1,
  },

  itemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  itemTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563eb",
    marginLeft: 7,
  },

  itemMessage: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 17,
    marginTop: 4,
  },

  itemTime: {
    fontSize: 10,
    color: "#9ca3af",
    marginTop: 6,
  },

  emptyNotifications: {
    paddingVertical: 55,
    paddingHorizontal: 25,
    alignItems: "center",
  },

  emptyIcon: {
    fontSize: 35,
    opacity: 0.5,
  },

  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#374151",
    marginTop: 10,
  },

  emptyText: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
});