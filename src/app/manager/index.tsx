import { useEffect, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { router } from "expo-router";

import { supabase } from "../../lib/supabase";
import { signOut } from "../../services/auth";

type ServiceRequest = {
  id: string;
  request_number: string;
  title: string;
  priority: string;
  status: string;
  machine_id: string;
};

type Evidence = {
  id: string;
  file_name: string;
  file_path: string;
  file_url: string | null;
};

type RequestWithEvidence = ServiceRequest & {
  evidence: Evidence[];
};

export default function ManagerDashboard() {
  const [requests, setRequests] = useState<
    RequestWithEvidence[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] =
    useState(false);

  useEffect(() => {
    loadRequests();

    const requestChannel = supabase
      .channel("manager-service-requests")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_requests",
        },
        () => {
          console.log(
            "MANAGER REQUEST REALTIME UPDATE"
          );

          loadRequests();
        }
      )
      .subscribe((status) => {
        console.log(
          "Manager request realtime:",
          status
        );
      });

    const documentChannel = supabase
      .channel("manager-service-documents")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
        },
        () => {
          console.log(
            "MANAGER DOCUMENT REALTIME UPDATE"
          );

          loadRequests();
        }
      )
      .subscribe((status) => {
        console.log(
          "Manager document realtime:",
          status
        );
      });

    return () => {
      supabase.removeChannel(requestChannel);
      supabase.removeChannel(documentChannel);
    };
  }, []);

  async function loadRequests() {
    try {
      const { data, error } = await supabase
        .from("service_requests")
        .select(
          `
          id,
          request_number,
          title,
          priority,
          status,
          machine_id
          `
        )
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        console.log(
          "REQUEST ERROR:",
          error
        );

        return;
      }

      const requestList = data ?? [];

      if (requestList.length === 0) {
        setRequests([]);
        return;
      }

      const requestIds = requestList.map(
        (request) => request.id
      );

      const {
        data: documentData,
        error: documentError,
      } = await supabase
        .from("documents")
        .select(
          "id, service_request_id, file_name, file_path, file_url"
        )
        .in(
          "service_request_id",
          requestIds
        )
        .eq(
          "document_type",
          "AFTER_PHOTO"
        )
        .order("created_at", {
          ascending: false,
        });

      if (documentError) {
        console.log(
          "DOCUMENT ERROR:",
          documentError
        );
      }

      const evidenceByRequest: Record<
        string,
        Evidence[]
      > = {};

      for (
        const document of documentData ?? []
      ) {
        console.log(
          "DOCUMENT FOUND:",
          document.file_name
        );

        console.log(
          "STORAGE PATH:",
          document.file_path
        );

        const {
          data: signedUrlData,
          error: signedUrlError,
        } = await supabase.storage
          .from("service-evidence")
          .createSignedUrl(
            document.file_path,
            60 * 60
          );

        if (signedUrlError) {
          console.log(
            "SIGNED URL ERROR:",
            signedUrlError
          );

          continue;
        }

        console.log(
          "SIGNED URL CREATED:",
          signedUrlData?.signedUrl
        );

        if (
          !evidenceByRequest[
            document.service_request_id
          ]
        ) {
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
          file_url:
            signedUrlData?.signedUrl ??
            null,
        });
      }

      const combinedData: RequestWithEvidence[] =
        requestList.map((request) => ({
          ...request,
          evidence:
            evidenceByRequest[
              request.id
            ] ?? [],
        }));

      setRequests(combinedData);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    try {
      setRefreshing(true);

      await loadRequests();
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.message ||
          "Unable to refresh requests."
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function verifyAndClose(
    request: ServiceRequest
  ) {
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
              } =
                await supabase.auth.getUser();

              if (!user) {
                Alert.alert(
                  "Error",
                  "Manager session not found."
                );

                return;
              }

              const now =
                new Date().toISOString();

              /*
               * Find latest assignment.
               */
              const {
                data: assignment,
                error:
                  assignmentFetchError,
              } = await supabase
                .from("assignments")
                .select(
                  "id, technician_id, status"
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

              if (assignmentFetchError) {
                throw assignmentFetchError;
              }

              /*
               * Approve completion record.
               */
              const {
                error: completionError,
              } = await supabase
                .from("completion_records")
                .update({
                  verification_status:
                    "APPROVED",
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

              /*
               * Close request.
               */
              const {
                error: requestError,
              } = await supabase
                .from("service_requests")
                .update({
                  status: "CLOSED",
                  approved_by: user.id,
                  approved_at: now,
                })
                .eq(
                  "id",
                  request.id
                );

              if (requestError) {
                throw requestError;
              }

              /*
               * Return machine to operational.
               */
              const {
                error: machineError,
              } = await supabase
                .from("machines")
                .update({
                  status: "OPERATIONAL",
                  last_service_date: now,
                })
                .eq(
                  "id",
                  request.machine_id
                );

              if (machineError) {
                console.log(
                  "MACHINE UPDATE ERROR:",
                  machineError
                );
              }

              /*
               * Ensure assignment is completed.
               */
              if (assignment?.id) {
                const {
                  error: assignmentError,
                } = await supabase
                  .from("assignments")
                  .update({
                    status: "COMPLETED",
                    completed_at: now,
                  })
                  .eq(
                    "id",
                    assignment.id
                  );

                if (assignmentError) {
                  console.log(
                    "ASSIGNMENT UPDATE ERROR:",
                    assignmentError
                  );
                }
              }

              /*
               * Release technician.
               */
              if (
                assignment?.technician_id
              ) {
                const {
                  data: technician,
                  error:
                    technicianFetchError,
                } = await supabase
                  .from("technicians")
                  .select(
                    "id, profile_id, current_workload"
                  )
                  .eq(
                    "id",
                    assignment.technician_id
                  )
                  .single();

                if (technicianFetchError) {
                  console.log(
                    "TECHNICIAN FETCH ERROR:",
                    technicianFetchError
                  );
                } else if (technician) {
                  const newWorkload =
                    Math.max(
                      0,
                      (technician.current_workload ??
                        0) - 1
                    );

                  const {
                    error:
                      technicianUpdateError,
                  } = await supabase
                    .from("technicians")
                    .update({
                      availability:
                        "AVAILABLE",
                      current_workload:
                        newWorkload,
                    })
                    .eq(
                      "id",
                      technician.id
                    );

                  if (
                    technicianUpdateError
                  ) {
                    console.log(
                      "TECHNICIAN UPDATE ERROR:",
                      technicianUpdateError
                    );
                  }

                  /*
                   * Notify technician.
                   */
                  const {
                    error:
                      notificationError,
                  } = await supabase
                    .from("notifications")
                    .insert({
                      user_id:
                        technician.profile_id,
                      type:
                        "REQUEST_VERIFIED",
                      title:
                        "Service Request Verified",
                      message:
                        `${request.request_number} has been verified and closed by the operations manager.`,
                      service_request_id:
                        request.id,
                    });

                  if (notificationError) {
                    console.log(
                      "NOTIFICATION ERROR:",
                      notificationError
                    );
                  }
                }
              }

              /*
               * Final service log.
               */
              const {
                error: logError,
              } = await supabase
                .from("service_logs")
                .insert({
                  service_request_id:
                    request.id,
                  action:
                    "MANAGER_VERIFIED",
                  description:
                    "Operations manager verified the service evidence, approved the completion record, and closed the request.",
                  created_by:
                    user.id,
                });

              if (logError) {
                console.log(
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
                error.message ||
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
    } catch (error) {
      Alert.alert(
        "Logout failed",
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    }
  }

  function getPriorityStyle(
    priority: string
  ) {
    switch (priority) {
      case "CRITICAL":
        return styles.critical;

      case "HIGH":
        return styles.high;

      case "MEDIUM":
        return styles.medium;

      default:
        return styles.low;
    }
  }

  function getStatusStyle(
    status: string
  ) {
    switch (status) {
      case "ASSIGNED":
        return styles.assigned;

      case "ACCEPTED":
        return styles.accepted;

      case "IN_PROGRESS":
        return styles.inProgress;

      case "VERIFICATION":
        return styles.verification;

      case "CLOSED":
        return styles.completed;

      case "CANCELLED":
        return styles.cancelled;

      default:
        return styles.defaultStatus;
    }
  }

  function renderRequest({
    item,
  }: {
    item: RequestWithEvidence;
  }) {
    const isVerification =
      item.status === "VERIFICATION";

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View
            style={{
              flex: 1,
            }}
          >
            <Text
              style={
                styles.requestNumber
              }
            >
              {item.request_number}
            </Text>

            <Text
              style={styles.requestTitle}
            >
              {item.title}
            </Text>
          </View>

          <View
            style={[
              styles.priorityBadge,
              getPriorityStyle(
                item.priority
              ),
            ]}
          >
            <Text
              style={styles.badgeText}
            >
              {item.priority}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Text
            style={styles.infoLabel}
          >
            Status
          </Text>

          <View
            style={[
              styles.statusBadge,
              getStatusStyle(
                item.status
              ),
            ]}
          >
            <Text
              style={styles.statusText}
            >
              {item.status}
            </Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Text
            style={styles.infoLabel}
          >
            Machine
          </Text>

          <Text
            style={styles.infoValue}
          >
            {item.machine_id}
          </Text>
        </View>

        {item.evidence.length > 0 && (
          <View
            style={
              styles.evidenceSection
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >
              Service Evidence
            </Text>

            <FlatList
              data={item.evidence}
              horizontal
              keyExtractor={(
                evidence
              ) => evidence.id}
              showsHorizontalScrollIndicator={
                false
              }
              renderItem={({
                item: evidence,
              }) => (
                <View
                  style={
                    styles.evidenceContainer
                  }
                >
                  {evidence.file_url ? (
                    <Image
                      source={{
                        uri: evidence.file_url,
                      }}
                      style={
                        styles.evidenceImage
                      }
                      onLoad={() => {
                        console.log(
                          "EVIDENCE IMAGE LOADED:",
                          evidence.file_name
                        );
                      }}
                      onError={(event) => {
                        console.log(
                          "EVIDENCE IMAGE ERROR:",
                          evidence.file_name,
                          event.nativeEvent
                            .error
                        );
                      }}
                    />
                  ) : (
                    <View
                      style={
                        styles.imagePlaceholder
                      }
                    >
                      <Text
                        style={
                          styles.placeholderText
                        }
                      >
                        Image unavailable
                      </Text>
                    </View>
                  )}

                  <Text
                    style={
                      styles.evidenceFileName
                    }
                    numberOfLines={1}
                  >
                    {evidence.file_name}
                  </Text>
                </View>
              )}
            />
          </View>
        )}

        {isVerification && (
          <View
            style={
              styles.verificationBox
            }
          >
            <Text
              style={
                styles.verificationTitle
              }
            >
              Verification Required
            </Text>

            <Text
              style={
                styles.verificationText
              }
            >
              Review the service evidence
              above before closing this
              request.
            </Text>

            <TouchableOpacity
              style={
                styles.verifyButton
              }
              disabled={
                actionLoading
              }
              onPress={() =>
                verifyAndClose(item)
              }
            >
              <Text
                style={
                  styles.buttonText
                }
              >
                {actionLoading
                  ? "Verifying..."
                  : "Verify & Close"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {item.status === "CLOSED" && (
          <View
            style={
              styles.completedBox
            }
          >
            <Text
              style={
                styles.completedText
              }
            >
              ✓ Service verified and
              closed
            </Text>
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
        />

        <Text
          style={styles.loadingText}
        >
          Loading manager dashboard...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text
            style={styles.headerTitle}
          >
            Manager Dashboard
          </Text>

          <Text
            style={styles.headerSubtitle}
          >
            Operations Manager
          </Text>
        </View>

        <View
          style={styles.headerActions}
        >
          <TouchableOpacity
            style={styles.createHeaderButton}
            onPress={() =>
              router.push(
                "/manager/create-request"
              )
            }
          >
            <Text
              style={
                styles.createHeaderText
              }
            >
              + Create Request
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.logoutButton}
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

      <View
        style={styles.summaryCard}
      >
        <View>
          <Text
            style={styles.summaryLabel}
          >
            Total Requests
          </Text>

          <Text
            style={styles.summaryValue}
          >
            {requests.length}
          </Text>
        </View>

        <View>
          <Text
            style={styles.summaryLabel}
          >
            Verification
          </Text>

          <Text
            style={styles.summaryValue}
          >
            {
              requests.filter(
                (request) =>
                  request.status ===
                  "VERIFICATION"
              ).length
            }
          </Text>
        </View>

        <View>
          <Text
            style={styles.summaryLabel}
          >
            Closed
          </Text>

          <Text
            style={styles.summaryValue}
          >
            {
              requests.filter(
                (request) =>
                  request.status ===
                  "CLOSED"
              ).length
            }
          </Text>
        </View>
      </View>

      <View
        style={styles.sectionHeader}
      >
        <Text
          style={styles.listTitle}
        >
          Service Requests
        </Text>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(item) =>
          item.id
        }
        renderItem={renderRequest}
        contentContainerStyle={
          styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
          />
        }
        ListEmptyComponent={
          <View
            style={styles.emptyCard}
          >
            <Text
              style={styles.emptyTitle}
            >
              No Service Requests
            </Text>

            <Text
              style={styles.emptyText}
            >
              There are currently no
              service requests to display.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },

  header: {
    paddingTop: 55,
    paddingHorizontal: 16,
    paddingBottom: 18,
    backgroundColor: "#172033",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  headerTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },

  headerSubtitle: {
    color: "#c7d0df",
    fontSize: 14,
    marginTop: 4,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  createHeaderButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#16a34a",
  },

  createHeaderText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },

  logoutButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#ffffff22",
  },

  logoutText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  summaryCard: {
    margin: 16,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    elevation: 2,
  },

  summaryLabel: {
    fontSize: 12,
    color: "#7b8494",
    marginBottom: 4,
  },

  summaryValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172033",
  },

  sectionHeader: {
    paddingHorizontal: 16,
    marginBottom: 10,
  },

  listTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#172033",
  },

  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },

  requestNumber: {
    fontSize: 12,
    color: "#6c7482",
    fontWeight: "600",
    marginBottom: 3,
  },

  requestTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172033",
  },

  priorityBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 10,
  },

  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },

  critical: {
    backgroundColor: "#c62828",
  },

  high: {
    backgroundColor: "#e66a00",
  },

  medium: {
    backgroundColor: "#c89500",
  },

  low: {
    backgroundColor: "#4d7c0f",
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#eef1f5",
  },

  infoLabel: {
    color: "#6c7482",
    fontSize: 13,
  },

  infoValue: {
    color: "#172033",
    fontSize: 13,
    fontWeight: "600",
    maxWidth: "65%",
    textAlign: "right",
  },

  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },

  statusText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },

  assigned: {
    backgroundColor: "#2563eb",
  },

  accepted: {
    backgroundColor: "#7c3aed",
  },

  inProgress: {
    backgroundColor: "#0891b2",
  },

  verification: {
    backgroundColor: "#d97706",
  },

  completed: {
    backgroundColor: "#16a34a",
  },

  cancelled: {
    backgroundColor: "#dc2626",
  },

  defaultStatus: {
    backgroundColor: "#64748b",
  },

  evidenceSection: {
    marginTop: 16,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#172033",
    marginBottom: 10,
  },

  evidenceContainer: {
    width: 180,
    marginRight: 12,
  },

  evidenceImage: {
    width: 180,
    height: 135,
    borderRadius: 12,
    backgroundColor: "#e5e7eb",
  },

  imagePlaceholder: {
    width: 180,
    height: 135,
    borderRadius: 12,
    backgroundColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
  },

  placeholderText: {
    color: "#6c7482",
    fontSize: 12,
  },

  evidenceFileName: {
    color: "#6c7482",
    fontSize: 11,
    marginTop: 5,
  },

  verificationBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
  },

  verificationTitle: {
    color: "#9a3412",
    fontSize: 15,
    fontWeight: "700",
  },

  verificationText: {
    color: "#7c2d12",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },

  verifyButton: {
    backgroundColor: "#16a34a",
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },

  completedBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#dcfce7",
  },

  completedText: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "600",
  },

  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
    marginTop: 10,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172033",
    marginBottom: 6,
  },

  emptyText: {
    color: "#6c7482",
    textAlign: "center",
    lineHeight: 20,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f7fa",
  },

  loadingText: {
    marginTop: 12,
    color: "#172033",
    fontSize: 15,
  },
});