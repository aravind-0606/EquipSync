import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import NotificationBell from "../../components/NotificationBell";
import { supabase } from "../../lib/supabase";
import { signOut } from "../../services/auth";

type Request = {
  id: string;
  request_number: string;
  title: string;
  priority: string;
  status: string;
  machine_id: string;

  machines?: {
    name: string;
    machine_code: string;
  } | null;
};

type Evidence = {
  id: string;
  file_name: string | null;
  file_path: string;
  file_url: string | null;
};

type RequestWithEvidence = Request & {
  evidence: Evidence[];
};

export default function ManagerDashboard() {
  const [requests, setRequests] = useState<RequestWithEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadRequests();

    const requestsChannel = supabase
      .channel("manager-service-requests")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_requests",
        },
        loadRequests
      )
      .subscribe();

    const documentsChannel = supabase
      .channel("manager-service-documents")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
        },
        loadRequests
      )
      .subscribe();

    return () => {
      supabase.removeChannel(requestsChannel);
      supabase.removeChannel(documentsChannel);
    };
  }, []);

  async function loadRequests() {
    try {
      const { data, error } = await supabase
        .from("service_requests")
        .select(`
  id,
  request_number,
  title,
  priority,
  status,
  machine_id,
  machines (
    name,
    machine_code
  )
`)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      const rows: Request[] = (data || []).map((row: any) => ({
  ...row,
  machines: row.machines ?? null,
}));

      if (!rows.length) {
        setRequests([]);
        return;
      }

      const ids = rows.map((request) => request.id);

      const {
        data: documents,
        error: documentError,
      } = await supabase
        .from("documents")
        .select(
          "id,service_request_id,file_name,file_path,file_url,document_type,created_at"
        )
        .in("service_request_id", ids)
        .eq("document_type", "AFTER_PHOTO")
        .order("created_at", {
          ascending: false,
        });

      if (documentError) {
        console.error(
          "DOCUMENT ERROR:",
          documentError
        );
      }

      const evidenceByRequest: Record<
        string,
        Evidence[]
      > = {};

      for (const document of documents || []) {
        const {
          data: signed,
          error: signedError,
        } = await supabase.storage
          .from("service-evidence")
          .createSignedUrl(
            document.file_path,
            60 * 60
          );

        if (signedError) {
          console.error(
            "SIGNED URL ERROR:",
            signedError
          );
          continue;
        }

        if (!evidenceByRequest[document.service_request_id]) {
          evidenceByRequest[
            document.service_request_id
          ] = [];
        }

        evidenceByRequest[
          document.service_request_id
        ].push({
          id: document.id,
          file_name: document.file_name,
          file_path: document.file_path,
          file_url: signed?.signedUrl || null,
        });
      }

      setRequests(
        rows.map((request) => ({
          ...request,
          evidence:
            evidenceByRequest[request.id] || [],
        }))
      );
    } catch (error: any) {
      console.error(
        "LOAD MANAGER REQUESTS ERROR:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to load service requests."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function refreshDashboard() {
    setRefreshing(true);
    await loadRequests();
  }

  async function verifyAndClose(request: Request) {
    Alert.alert(
      "Verify Service",
      `Are you sure you want to verify and close ${request.request_number}?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Verify & Close",
          onPress: async () => {
            try {
              setActionLoading(true);

              const {
                data: { user },
                error: userError,
              } = await supabase.auth.getUser();

              if (userError) {
                throw userError;
              }

              if (!user) {
                throw new Error(
                  "Manager session not found."
                );
              }

              const now = new Date().toISOString();

              const {
                data: assignment,
                error: assignmentError,
              } = await supabase
                .from("assignments")
                .select(
                  "id,technician_id,status"
                )
                .eq(
                  "service_request_id",
                  request.id
                )
                .order("assigned_at", {
                  ascending: false,
                })
                .limit(1)
                .maybeSingle();

              if (assignmentError) {
                throw assignmentError;
              }

              const {
                error: completionError,
              } = await supabase
                .from("completion_records")
                .update({
                  verification_status: "APPROVED",
                  verified_by: user.id,
                  verified_at: now,
                })
                .eq(
                  "service_request_id",
                  request.id
                )
                .eq(
                  "verification_status",
                  "PENDING"
                );

              if (completionError) {
                throw completionError;
              }

              const {
                error: requestError,
              } = await supabase
                .from("service_requests")
                .update({
                  status: "CLOSED",
                  approved_by: user.id,
                  approved_at: now,
                })
                .eq("id", request.id);

              if (requestError) {
                throw requestError;
              }

              const {
                error: machineError,
              } = await supabase
                .from("machines")
                .update({
                  status: "OPERATIONAL",
                  last_service_date: now,
                })
                .eq("id", request.machine_id);

              if (machineError) {
                console.error(
                  "MACHINE UPDATE ERROR:",
                  machineError
                );
              }

              if (assignment?.id) {
                const {
                  error: assignmentUpdateError,
                } = await supabase
                  .from("assignments")
                  .update({
                    status: "COMPLETED",
                    completed_at: now,
                  })
                  .eq("id", assignment.id);

                if (assignmentUpdateError) {
                  console.error(
                    "ASSIGNMENT UPDATE ERROR:",
                    assignmentUpdateError
                  );
                }
              }

              if (assignment?.technician_id) {
                const {
                  data: technician,
                  error: technicianError,
                } = await supabase
                  .from("technicians")
                  .select(
                    "id,profile_id,current_workload"
                  )
                  .eq(
                    "id",
                    assignment.technician_id
                  )
                  .single();

                if (technicianError) {
                  console.error(
                    "TECHNICIAN FETCH ERROR:",
                    technicianError
                  );
                }

                if (technician) {
                  const newWorkload = Math.max(
                    0,
                    (technician.current_workload ||
                      0) - 1
                  );

                  await supabase
                    .from("technicians")
                    .update({
                      availability: "AVAILABLE",
                      current_workload: newWorkload,
                    })
                    .eq("id", technician.id);

                  const {
                    error: notificationError,
                  } = await supabase
                    .from("notifications")
                    .insert({
                      user_id:
                        technician.profile_id,
                      notification_type:
                        "REQUEST_VERIFIED",
                      title:
                        "Service Request Verified",
                      message:
                        `${request.request_number} has been verified and closed by the operations manager.`,
                      reference_id: request.id,
                      reference_type:
                        "service_request",
                      is_read: false,
                    });

                  if (notificationError) {
                    console.error(
                      "NOTIFICATION ERROR:",
                      notificationError
                    );
                  }
                }
              }

              const {
                error: logError,
              } = await supabase
                .from("service_logs")
                .insert({
                  service_request_id: request.id,
                  log_type: "NOTE",
                  message:
                    "Operations manager verified the service evidence, approved the completion record, and closed the request.",
                  created_by: user.id,
                  metadata: {
                    request_number:
                      request.request_number,
                  },
                });

              if (logError) {
                console.error(
                  "VERIFICATION LOG ERROR:",
                  logError
                );
              }

              await loadRequests();

              Alert.alert(
                "Service Verified",
                `${request.request_number} has been verified and closed successfully.`
              );
            } catch (error: any) {
              console.error(
                "VERIFY ERROR:",
                error
              );

              Alert.alert(
                "Verification Failed",
                error?.message ||
                  "Unable to verify the service request."
              );
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }

  async function handleLogout() {
    try {
      await signOut();
      router.replace("/");
    } catch (error: any) {
      Alert.alert(
        "Logout Failed",
        error?.message ||
          "Unable to logout."
      );
    }
  }

  function priorityStyle(priority: string) {
    if (priority === "CRITICAL") {
      return styles.critical;
    }

    if (priority === "HIGH") {
      return styles.high;
    }

    if (priority === "MEDIUM") {
      return styles.medium;
    }

    return styles.low;
  }

  function statusStyle(status: string) {
    switch (status) {
      case "PENDING":
        return styles.pending;

      case "VALIDATING":
        return styles.validating;

      case "AWAITING_APPROVAL":
        return styles.awaiting;

      case "APPROVED":
        return styles.approved;

      case "ASSIGNED":
        return styles.assigned;

      case "ACCEPTED":
        return styles.accepted;

      case "IN_PROGRESS":
        return styles.inProgress;

      case "ON_HOLD":
        return styles.onHold;

      case "VERIFICATION":
        return styles.verification;

      case "CLOSED":
        return styles.closed;

      case "CANCELLED":
        return styles.cancelled;

      default:
        return styles.pending;
    }
  }

  function renderCard(
    request: RequestWithEvidence
  ) {
    return (
      <View
        key={request.id}
        style={
          request.status === "VERIFICATION"
            ? styles.verificationCard
            : styles.card
        }
      >
        <View style={styles.top}>
          <View
            style={{
              flex: 1,
              paddingRight: 10,
            }}
          >
            <Text style={styles.number}>
              {request.request_number}
            </Text>

            <Text style={styles.cardTitle}>
              {request.title}
            </Text>
          </View>

          <View
            style={[
              styles.badge,
              priorityStyle(request.priority),
            ]}
          >
            <Text style={styles.badgeText}>
              {request.priority}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <View
            style={[
              styles.badge,
              statusStyle(request.status),
            ]}
          >
            <Text style={styles.badgeText}>
              {request.status.replace(
                /_/g,
                " "
              )}
            </Text>
          </View>

          <Text
  style={styles.machineText}
  numberOfLines={1}
>
  Machine:{" "}
  {request.machines?.machine_code ||
    request.machine_id}

  {request.machines?.name
    ? ` — ${request.machines.name}`
    : ""}
</Text>
        </View>

        {request.evidence.length > 0 && (
          <View style={styles.evidence}>
            <View
              style={styles.evidenceHeader}
            >
              <Text
                style={styles.evidenceTitle}
              >
                Service Evidence
              </Text>

              <Text style={styles.muted}>
                {request.evidence.length} photo
                {request.evidence.length !== 1
                  ? "s"
                  : ""}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={
                false
              }
            >
              {request.evidence.map(
                (evidence) => (
                  <View
                    key={evidence.id}
                    style={
                      styles.evidenceItem
                    }
                  >
                    {evidence.file_url ? (
                      <Image
                        source={{
                          uri: evidence.file_url,
                        }}
                        style={styles.image}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={[
                          styles.image,
                          styles.placeholder,
                        ]}
                      >
                        <Text
                          style={styles.muted}
                        >
                          Image unavailable
                        </Text>
                      </View>
                    )}

                    <Text
                      style={styles.fileName}
                      numberOfLines={1}
                    >
                      {evidence.file_name ||
                        "Service photo"}
                    </Text>
                  </View>
                )
              )}
            </ScrollView>
          </View>
        )}

        {request.evidence.length === 0 &&
          [
            "VERIFICATION",
            "IN_PROGRESS",
            "COMPLETED",
          ].includes(request.status) && (
            <View style={styles.noEvidence}>
              <Text style={styles.muted}>
                No service evidence uploaded yet.
              </Text>
            </View>
          )}

        {request.status === "VERIFICATION" && (
          <TouchableOpacity
            style={styles.verifyButton}
            disabled={actionLoading}
            onPress={() =>
              verifyAndClose(request)
            }
          >
            <Text style={styles.buttonText}>
              {actionLoading
                ? "Verifying..."
                : "Verify & Close"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const total = requests.length;

  const verification = requests.filter(
    (request) =>
      request.status === "VERIFICATION"
  ).length;

  const closed = requests.filter(
    (request) => request.status === "CLOSED"
  ).length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshDashboard}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View
              style={{
                flex: 1,
                paddingRight: 10,
              }}
            >
              <Text style={styles.title}>
                Manager Dashboard
              </Text>

              <Text style={styles.subtitle}>
                Equipment service operations
              </Text>
            </View>

            <View style={styles.headerActions}>
              <NotificationBell />

              <TouchableOpacity
                style={styles.logout}
                onPress={handleLogout}
              >
                <Text
                  style={styles.logoutText}
                >
                  Logout
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.primary}
              onPress={() =>
                router.push(
                  "/manager/create-request"
                )
              }
            >
              <Text style={styles.buttonText}>
                + Create Request
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondary}
              onPress={() =>
                router.push(
                  "/manager/spare-parts"
                )
              }
            >
              <Text style={styles.buttonText}>
                Spare Parts
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.summary}>
          <Stat
            number={total}
            label="Total Requests"
          />

          <Stat
            number={verification}
            label="Pending Verification"
          />

          <Stat
            number={closed}
            label="Closed"
          />
        </View>

        {verification > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Verification Required
            </Text>

            <Text style={styles.sectionSubtitle}>
              Review completed service requests
            </Text>

            {requests
              .filter(
                (request) =>
                  request.status ===
                  "Pending Verification"
              )
              .map(renderCard)}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Service Requests
          </Text>

          <Text style={styles.sectionSubtitle}>
            Latest equipment service activity
          </Text>

          {loading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" />

              <Text style={styles.muted}>
                Loading service requests...
              </Text>
            </View>
          ) : requests.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                No service requests
              </Text>

              <Text style={styles.muted}>
                Create a service request to
                start the workflow.
              </Text>
            </View>
          ) : (
            requests.map(renderCard)
          )}
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  number,
  label,
}: {
  number: number;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statNumber}>
        {number}
      </Text>

      <Text style={styles.muted}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },

  header: {
    backgroundColor: "#ffffff",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  title: {
    fontSize: 25,
    fontWeight: "800",
    color: "#111827",
  },

  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#6b7280",
  },

  logout: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },

  logoutText: {
    color: "#b91c1c",
    fontWeight: "700",
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },

  primary: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },

  secondary: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  summary: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingBottom: 0,
  },

  stat: {
    flex: 1,
    minHeight: 88,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },

  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
  },

  section: {
    padding: 16,
    paddingBottom: 0,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },

  sectionSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 3,
    marginBottom: 10,
  },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  verificationCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#fde68a",
  },

  top: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  number: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2563eb",
    marginBottom: 5,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },

  machine: {
    flex: 1,
    marginLeft: 10,
    textAlign: "right",
    fontSize: 11,
    color: "#6b7280",
  },

  badge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
  },

  badgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#ffffff",
  },

  critical: {
    backgroundColor: "#dc2626",
  },

  high: {
    backgroundColor: "#ea580c",
  },

  medium: {
    backgroundColor: "#ca8a04",
  },

  low: {
    backgroundColor: "#16a34a",
  },

  pending: {
    backgroundColor: "#6b7280",
  },

  validating: {
    backgroundColor: "#0284c7",
  },

  awaiting: {
    backgroundColor: "#ca8a04",
  },

  approved: {
    backgroundColor: "#16a34a",
  },

  assigned: {
    backgroundColor: "#2563eb",
  },

  accepted: {
    backgroundColor: "#4f46e5",
  },

  inProgress: {
    backgroundColor: "#0891b2",
  },

  onHold: {
    backgroundColor: "#ca8a04",
  },

  verification: {
    backgroundColor: "#7c3aed",
  },

  closed: {
    backgroundColor: "#16a34a",
  },

  cancelled: {
    backgroundColor: "#dc2626",
  },

  evidence: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },

  evidenceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  evidenceTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
  },

  evidenceItem: {
    width: 150,
    marginRight: 10,
  },

  image: {
    width: 150,
    height: 115,
    borderRadius: 10,
    backgroundColor: "#e5e7eb",
  },

  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },

  fileName: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 5,
  },

  noEvidence: {
    marginTop: 14,
    padding: 11,
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  verifyButton: {
    height: 42,
    marginTop: 16,
    borderRadius: 9,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
  },
  machineText: {
  fontSize: 13,
  color: "#666",
  marginTop: 4,
},  

  empty: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 30,
    alignItems: "center",
    marginTop: 5,
  },

  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 6,
  },

  muted: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 6,
    textAlign: "center",
  },
});