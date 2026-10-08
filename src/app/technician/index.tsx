import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import NotificationBell from "../../components/NotificationBell";
import { supabase } from "../../lib/supabase";

type Assignment = {
  id: string;
  service_request_id: string;
  technician_id: string;
  assigned_by: string | null;
  status: string;
  match_score: number | null;
  assigned_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  rejection_reason: string | null;
};

type ServiceRequest = {
  id: string;
  request_number: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  machine_id: string;
  site_id: string;
  sla_deadline: string | null;
};

type Technician = {
  id: string;
  profile_id: string;
  employee_code: string;
  availability: string;
  current_workload: number;
};

export default function TechnicianDashboard() {
  const [user, setUser] = useState<any>(null);
  const [technician, setTechnician] =
    useState<Technician | null>(null);
  const [assignments, setAssignments] =
    useState<Assignment[]>([]);
  const [requests, setRequests] =
    useState<Record<string, ServiceRequest>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [uploadingId, setUploadingId] =
    useState<string | null>(null);
  const [workingId, setWorkingId] =
    useState<string | null>(null);

  useEffect(() => {
    initialize();

    return () => {
      supabase.removeAllChannels();
    };
  }, []);

  async function initialize() {
    try {
      setLoading(true);

      const {
        data: { user: currentUser },
        error,
      } = await supabase.auth.getUser();

      if (error) {
        throw error;
      }

      if (!currentUser) {
        throw new Error(
          "No authenticated user found."
        );
      }

      setUser(currentUser);

      await loadTechnician(currentUser.id);
    } catch (error: any) {
      console.error(
        "INITIALIZATION ERROR:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to load dashboard."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadTechnician(
    profileId: string
  ) {
    const { data, error } = await supabase
      .from("technicians")
      .select("*")
      .eq("profile_id", profileId)
      .single();

    if (error) {
      throw error;
    }

    setTechnician(data);

    await loadAssignments(data.id);

    subscribeToAssignments(data.id);
  }

  async function loadAssignments(
    technicianId: string
  ) {
    const {
      data,
      error,
    } = await supabase
      .from("assignments")
      .select("*")
      .eq("technician_id", technicianId)
      .order("assigned_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    const assignmentList =
      (data || []) as Assignment[];

    setAssignments(assignmentList);

    if (assignmentList.length === 0) {
      setRequests({});
      return;
    }

    const requestIds = [
      ...new Set(
        assignmentList.map(
          (assignment) =>
            assignment.service_request_id
        )
      ),
    ];

    const {
      data: requestData,
      error: requestError,
    } = await supabase
      .from("service_requests")
      .select("*")
      .in("id", requestIds);

    if (requestError) {
      throw requestError;
    }

    const requestMap: Record<
      string,
      ServiceRequest
    > = {};

    for (const request of requestData || []) {
      requestMap[request.id] =
        request as ServiceRequest;
    }

    setRequests(requestMap);
  }

  function subscribeToAssignments(
    technicianId: string
  ) {
    const channel = supabase
      .channel(
        `technician-assignments-${technicianId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assignments",
          filter: `technician_id=eq.${technicianId}`,
        },
        () => {
          loadAssignments(technicianId);
        }
      )
      .subscribe();

    return channel;
  }

  async function refresh() {
    if (!technician) {
      return;
    }

    try {
      setRefreshing(true);
      await loadAssignments(
        technician.id
      );
    } catch (error: any) {
      Alert.alert(
        "Error",
        error?.message ||
          "Unable to refresh."
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function acceptAssignment(
    assignment: Assignment
  ) {
    try {
      setWorkingId(assignment.id);

      const {
        error: assignmentError,
      } = await supabase
        .from("assignments")
        .update({
          status: "ACCEPTED",
          accepted_at:
            new Date().toISOString(),
        })
        .eq("id", assignment.id)
        .eq(
          "technician_id",
          technician?.id
        );

      if (assignmentError) {
        throw assignmentError;
      }

      const {
        error: requestError,
      } = await supabase
        .from("service_requests")
        .update({
          status: "ACCEPTED",
        })
        .eq(
          "id",
          assignment.service_request_id
        );

      if (requestError) {
        throw requestError;
      }

      await supabase
        .from("service_logs")
        .insert({
          service_request_id:
            assignment.service_request_id,
          technician_id:
            technician?.id,
          log_type: "NOTE",
          message:
            "Technician accepted the service assignment.",
          created_by: user?.id,
        });

      Alert.alert(
        "Accepted",
        "The service assignment has been accepted."
      );

      await loadAssignments(
        technician!.id
      );
    } catch (error: any) {
      console.error(
        "ACCEPT ERROR:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to accept assignment."
      );
    } finally {
      setWorkingId(null);
    }
  }

  async function rejectAssignment(
    assignment: Assignment
  ) {
    Alert.alert(
      "Reject Assignment",
      "Are you sure you want to reject this assignment? The system will automatically find the next-best available technician.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Reject & Reassign",
          style: "destructive",
          onPress: async () => {
            try {
              setWorkingId(assignment.id);

              const {
                data,
                error,
              } = await supabase.rpc(
                "reject_and_reassign_service_request",
                {
                  assignment_id_input:
                    assignment.id,
                }
              );

              if (error) {
                throw error;
              }

              const result = data?.[0];

              if (!result) {
                throw new Error(
                  "The assignment was rejected, but no replacement technician was returned."
                );
              }

              Alert.alert(
                "Reassigned",
                `${result.technician_name} has been assigned as the next-best technician.\n\nMatch Score: ${Number(
                  result.match_score
                ).toFixed(0)}`
              );

              await loadAssignments(
                technician!.id
              );
            } catch (error: any) {
              console.error(
                "REJECT/REASSIGN ERROR:",
                error
              );

              Alert.alert(
                "Reassignment Failed",
                error?.message ||
                  "Unable to reject and reassign the service request."
              );

              await loadAssignments(
                technician!.id
              );
            } finally {
              setWorkingId(null);
            }
          },
        },
      ]
    );
  }

  async function startWork(
    assignment: Assignment
  ) {
    try {
      setWorkingId(assignment.id);

      const {
        error: assignmentError,
      } = await supabase
        .from("assignments")
        .update({
          status: "IN_PROGRESS",
          started_at:
            new Date().toISOString(),
        })
        .eq("id", assignment.id)
        .eq(
          "technician_id",
          technician?.id
        );

      if (assignmentError) {
        throw assignmentError;
      }

      const {
        error: requestError,
      } = await supabase
        .from("service_requests")
        .update({
          status: "IN_PROGRESS",
        })
        .eq(
          "id",
          assignment.service_request_id
        );

      if (requestError) {
        throw requestError;
      }

      await supabase
        .from("service_logs")
        .insert({
          service_request_id:
            assignment.service_request_id,
          technician_id:
            technician?.id,
          log_type: "NOTE",
          message:
            "Technician started work on the service assignment.",
          created_by: user?.id,
        });

      Alert.alert(
        "Work Started",
        "The service request is now in progress."
      );

      await loadAssignments(
        technician!.id
      );
    } catch (error: any) {
      Alert.alert(
        "Error",
        error?.message ||
          "Unable to start work."
      );
    } finally {
      setWorkingId(null);
    }
  }

  async function uploadEvidence(
    assignment: Assignment
  ) {
    try {
      setUploadingId(assignment.id);

      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Permission Required",
          "Please allow photo library access to upload service evidence."
        );

        return;
      }

      const result =
        await ImagePicker.launchImageLibraryAsync(
          {
            mediaTypes: ["images"],
            allowsMultipleSelection: false,
            allowsEditing: false,
            quality: 1,
            exif: false,
          }
        );

      if (
        result.canceled ||
        !result.assets?.length
      ) {
        return;
      }

      const image = result.assets[0];

      if (!image.uri) {
        throw new Error(
          "Selected image does not have a URI."
        );
      }

      const file = new File(image.uri);

      if (!file.exists) {
        throw new Error(
          "Selected image file does not exist."
        );
      }

      const arrayBuffer =
        await file.arrayBuffer();

      if (!arrayBuffer.byteLength) {
        throw new Error(
          "Selected image contains no data."
        );
      }

      let extension = "jpeg";

      if (
        image.mimeType === "image/png"
      ) {
        extension = "png";
      } else if (
        image.mimeType === "image/webp"
      ) {
        extension = "webp";
      } else if (
        image.mimeType === "image/heic"
      ) {
        extension = "heic";
      } else if (
        image.mimeType === "image/heif"
      ) {
        extension = "heif";
      }

      const contentType =
        image.mimeType ||
        (extension === "png"
          ? "image/png"
          : extension === "webp"
          ? "image/webp"
          : "image/jpeg");

      const filePath = `${user.id}/${assignment.service_request_id}/${Date.now()}.${extension}`;

      const {
        error: uploadError,
      } = await supabase.storage
        .from("service-evidence")
        .upload(
          filePath,
          arrayBuffer,
          {
            contentType,
            cacheControl: "3600",
            upsert: false,
          }
        );

      if (uploadError) {
        throw uploadError;
      }

      const {
        error: documentError,
      } = await supabase
        .from("documents")
        .insert({
          service_request_id:
            assignment.service_request_id,
          uploaded_by: user.id,
          document_type: "AFTER_PHOTO",
          file_name:
            image.fileName ||
            `service-evidence-${Date.now()}.${extension}`,
          file_path: filePath,
          file_url: null,
          mime_type: contentType,
          file_size:
            arrayBuffer.byteLength,
        })
        .select()
        .single();

      if (documentError) {
        await supabase.storage
          .from("service-evidence")
          .remove([filePath]);

        throw documentError;
      }

      await supabase
        .from("service_logs")
        .insert({
          service_request_id:
            assignment.service_request_id,
          technician_id:
            technician?.id,
          log_type: "NOTE",
          message:
            "Technician uploaded after-service photo evidence.",
          created_by: user?.id,
        });

      Alert.alert(
        "Photo Uploaded",
        "Service evidence photo has been uploaded successfully."
      );
    } catch (error: any) {
      console.error(
        "UPLOAD EVIDENCE ERROR:",
        error
      );

      Alert.alert(
        "Upload Failed",
        error?.message ||
          "Unable to upload service evidence."
      );
    } finally {
      setUploadingId(null);
    }
  }

  async function completeWork(
    assignment: Assignment
  ) {
    try {
      setWorkingId(assignment.id);

      const {
        data: evidence,
        error: evidenceError,
      } = await supabase
        .from("documents")
        .select("id")
        .eq(
          "service_request_id",
          assignment.service_request_id
        )
        .eq(
          "uploaded_by",
          user?.id
        )
        .eq(
          "document_type",
          "AFTER_PHOTO"
        );

      if (evidenceError) {
        throw evidenceError;
      }

      if (!evidence?.length) {
        Alert.alert(
          "Photo Required",
          "Please upload at least one after-service photo before completing the work."
        );

        return;
      }

      const {
        error: completionError,
      } = await supabase
        .from("completion_records")
        .insert({
          service_request_id:
            assignment.service_request_id,
          technician_id:
            technician!.id,
          work_summary:
            "Hydraulic inspection completed. Service evidence photo submitted for manager verification.",
          machine_condition:
            "Inspection completed; evidence photo submitted.",
          additional_notes:
            "Technician completed the assigned service work and submitted it for manager verification.",
          submitted_at:
            new Date().toISOString(),
          verification_status: "PENDING",
        });

      if (completionError) {
        throw completionError;
      }

      const {
        error: assignmentError,
      } = await supabase
        .from("assignments")
        .update({
          status: "COMPLETED",
          completed_at:
            new Date().toISOString(),
        })
        .eq("id", assignment.id)
        .eq(
          "technician_id",
          technician?.id
        );

      if (assignmentError) {
        throw assignmentError;
      }

      const {
        error: requestError,
      } = await supabase
        .from("service_requests")
        .update({
          status: "VERIFICATION",
        })
        .eq(
          "id",
          assignment.service_request_id
        );

      if (requestError) {
        throw requestError;
      }

      await supabase
        .from("service_logs")
        .insert({
          service_request_id:
            assignment.service_request_id,
          technician_id:
            technician?.id,
          log_type: "NOTE",
          message:
            "Technician completed the work and submitted it for manager verification.",
          created_by: user?.id,
        });

      if (assignment.assigned_by) {
        await supabase
          .from("notifications")
          .insert({
            user_id:
              assignment.assigned_by,
            reference_id:
              assignment.service_request_id,
            reference_type:
              "SERVICE_REQUEST",
            notification_type:
              "VERIFICATION_REQUIRED",
            title:
              "Service Verification Required",
            message:
              "A technician has completed the service request and submitted it for verification.",
            is_read: false,
          });
      }

      Alert.alert(
        "Work Completed",
        "The service has been submitted for manager verification."
      );

      await loadAssignments(
        technician!.id
      );
    } catch (error: any) {
      console.error(
        "COMPLETE WORK ERROR:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to complete the service."
      );
    } finally {
      setWorkingId(null);
    }
  }

  async function logout() {
    try {
      await supabase.auth.signOut();
    } catch (error: any) {
      Alert.alert(
        "Logout Error",
        error?.message ||
          "Unable to logout."
      );
    }
  }

  function priorityStyle(
    priority: string
  ) {
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
      case "ASSIGNED":
        return styles.assigned;

      case "ACCEPTED":
        return styles.accepted;

      case "IN_PROGRESS":
        return styles.inProgress;

      case "COMPLETED":
        return styles.completed;

      case "REJECTED":
        return styles.rejected;

      default:
        return styles.defaultStatus;
    }
  }

  function renderAssignment(
    assignment: Assignment
  ) {
    const request =
      requests[
        assignment.service_request_id
      ];

    if (!request) {
      return null;
    }

    const busy =
      workingId === assignment.id;

    const uploading =
      uploadingId === assignment.id;

    return (
      <View
        key={assignment.id}
        style={styles.card}
      >
        <View style={styles.cardHeader}>
          <View
            style={{
              flex: 1,
              paddingRight: 10,
            }}
          >
            <Text style={styles.requestNumber}>
              {request.request_number}
            </Text>

            <Text style={styles.title}>
              {request.title}
            </Text>
          </View>

          <View
            style={[
              styles.priorityBadge,
              priorityStyle(
                request.priority
              ),
            ]}
          >
            <Text style={styles.badgeText}>
              {request.priority}
            </Text>
          </View>
        </View>

        <Text style={styles.description}>
          {request.description ||
            "No description provided."}
        </Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>
            Assignment
          </Text>

          <View
            style={[
              styles.statusBadge,
              statusStyle(
                assignment.status
              ),
            ]}
          >
            <Text style={styles.statusText}>
              {assignment.status}
            </Text>
          </View>
        </View>

        {assignment.match_score !==
          null && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>
              Match Score
            </Text>

            <Text style={styles.infoValue}>
              {Number(
                assignment.match_score
              ).toFixed(0)}
            </Text>
          </View>
        )}

        {request.sla_deadline && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>
              SLA Deadline
            </Text>

            <Text style={styles.infoValue}>
              {new Date(
                request.sla_deadline
              ).toLocaleString()}
            </Text>
          </View>
        )}

        {assignment.status ===
          "ASSIGNED" && (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.button,
                styles.reject,
              ]}
              onPress={() =>
                rejectAssignment(
                  assignment
                )
              }
              disabled={busy}
            >
              <Text
                style={styles.buttonText}
              >
                {busy
                  ? "Reassigning..."
                  : "Reject"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.accept,
              ]}
              onPress={() =>
                acceptAssignment(
                  assignment
                )
              }
              disabled={busy}
            >
              <Text
                style={styles.buttonText}
              >
                {busy
                  ? "Please wait..."
                  : "Accept"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {assignment.status ===
          "ACCEPTED" && (
          <TouchableOpacity
            style={[
              styles.button,
              styles.start,
            ]}
            onPress={() =>
              startWork(assignment)
            }
            disabled={busy}
          >
            <Text
              style={styles.buttonText}
            >
              {busy
                ? "Starting..."
                : "Start Work"}
            </Text>
          </TouchableOpacity>
        )}

        {assignment.status ===
          "IN_PROGRESS" && (
          <>
            <TouchableOpacity
              style={[
                styles.button,
                styles.photo,
              ]}
              onPress={() =>
                uploadEvidence(
                  assignment
                )
              }
              disabled={uploading}
            >
              <Text
                style={styles.buttonText}
              >
                {uploading
                  ? "Uploading Photo..."
                  : "Add Photo Evidence"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.complete,
              ]}
              onPress={() =>
                completeWork(
                  assignment
                )
              }
              disabled={busy}
            >
              <Text
                style={styles.buttonText}
              >
                {busy
                  ? "Submitting..."
                  : "Complete Work"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {assignment.status ===
          "COMPLETED" && (
          <View
            style={styles.completedBox}
          >
            <Text
              style={styles.completedText}
            >
              ✓ Work completed and submitted
              for verification
            </Text>
          </View>
        )}

        {assignment.status ===
          "REJECTED" && (
          <View
            style={styles.rejectedBox}
          >
            <Text
              style={styles.rejectedText}
            >
              Assignment rejected.
            </Text>
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />

        <Text style={styles.loadingText}>
          Loading technician dashboard...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>
            Technician Dashboard
          </Text>

          <Text
            style={styles.headerSubtitle}
          >
            {technician?.employee_code ||
              "Technician"}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <NotificationBell />

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={logout}
          >
            <Text style={styles.logoutText}>
              Logout
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.profileCard}>
        <Stat
          label="Availability"
          value={
            technician?.availability ||
            "UNKNOWN"
          }
        />

        <Stat
          label="Workload"
          value={
            technician?.current_workload ??
            0
          }
        />

        <Stat
          label="Assignments"
          value={assignments.length}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
          />
        }
      >
        <Text style={styles.sectionTitle}>
          My Assignments
        </Text>

        {assignments.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              No Assignments
            </Text>

            <Text style={styles.muted}>
              You currently have no service
              assignments.
            </Text>
          </View>
        ) : (
          assignments.map(
            renderAssignment
          )
        )}
      </ScrollView>
    </View>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <View>
      <Text style={styles.profileLabel}>
        {label}
      </Text>

      <Text style={styles.profileValue}>
        {value}
      </Text>
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
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: "#172033",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  headerLeft: {
    flex: 1,
    paddingRight: 10,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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

  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#ffffff22",
  },

  logoutText: {
    color: "#ffffff",
    fontWeight: "600",
  },

  profileCard: {
    margin: 16,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    elevation: 2,
  },

  profileLabel: {
    fontSize: 12,
    color: "#7b8494",
    marginBottom: 4,
  },

  profileValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#172033",
  },

  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#172033",
    marginBottom: 12,
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
    marginBottom: 10,
  },

  requestNumber: {
    fontSize: 12,
    color: "#6c7482",
    fontWeight: "600",
    marginBottom: 3,
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172033",
  },

  description: {
    color: "#5d6675",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
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
    paddingVertical: 7,
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

  completed: {
    backgroundColor: "#16a34a",
  },

  rejected: {
    backgroundColor: "#dc2626",
  },

  defaultStatus: {
    backgroundColor: "#64748b",
  },

  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },

  button: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    marginTop: 12,
  },

  accept: {
    backgroundColor: "#16a34a",
  },

  reject: {
    backgroundColor: "#dc2626",
  },

  start: {
    backgroundColor: "#2563eb",
  },

  photo: {
    backgroundColor: "#7c3aed",
  },

  complete: {
    backgroundColor: "#16a34a",
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

  rejectedBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#fee2e2",
  },

  rejectedText: {
    color: "#991b1b",
    fontSize: 13,
    fontWeight: "600",
  },

  empty: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#172033",
    marginBottom: 6,
  },

  muted: {
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
    color: "#172033",
    fontSize: 15,
    marginTop: 10,
  },
});