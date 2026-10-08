import { useEffect, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { router } from "expo-router";

import { supabase } from "../../lib/supabase";

type Site = {
  id: string;
  name: string;
  location: string | null;
};

type Machine = {
  id: string;
  machine_code: string;
  name: string;
  machine_type: string | null;
  site_id: string;
  status: string;
};

const SKILLS = [
  "Mechanical",
  "Electrical",
  "Hydraulic",
  "PLC",
  "Welding",
  "HVAC",
];

const PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];

export default function CreateRequestScreen() {
  const [sites, setSites] = useState<Site[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);

  const [selectedSite, setSelectedSite] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [priority, setPriority] = useState("MEDIUM");

  const [requiredSkills, setRequiredSkills] = useState<string[]>(
    []
  );

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);

      const {
        data: siteData,
        error: siteError,
      } = await supabase
        .from("sites")
        .select("id, name, location")
        .order("name");

      if (siteError) {
        throw siteError;
      }

      const {
        data: machineData,
        error: machineError,
      } = await supabase
        .from("machines")
        .select(
          "id, machine_code, name, machine_type, site_id, status"
        )
        .order("machine_code");

      if (machineError) {
        throw machineError;
      }

      setSites(siteData ?? []);
      setMachines(machineData ?? []);
    } catch (error: any) {
      console.error("LOAD CREATE REQUEST DATA ERROR:", error);

      Alert.alert(
        "Error",
        error.message || "Unable to load sites and machines."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleSkill(skill: string) {
    setRequiredSkills((current) => {
      if (current.includes(skill)) {
        return current.filter((item) => item !== skill);
      }

      return [...current, skill];
    });
  }

  function selectSite(siteId: string) {
    setSelectedSite(siteId);

    // Reset machine when site changes
    setSelectedMachine("");
  }

  const filteredMachines = machines.filter(
    (machine) => machine.site_id === selectedSite
  );

  async function createRequest() {
    try {
      if (!title.trim()) {
        Alert.alert(
          "Missing Information",
          "Please enter a request title."
        );
        return;
      }

      if (!description.trim()) {
        Alert.alert(
          "Missing Information",
          "Please enter a description."
        );
        return;
      }

      if (!selectedSite) {
        Alert.alert(
          "Missing Information",
          "Please select a site."
        );
        return;
      }

      if (!selectedMachine) {
        Alert.alert(
          "Missing Information",
          "Please select a machine."
        );
        return;
      }

      if (requiredSkills.length === 0) {
        Alert.alert(
          "Missing Information",
          "Please select at least one required skill."
        );
        return;
      }

      setSubmitting(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "Manager session not found. Please login again."
        );
      }

      const requestNumber =
        "SR-" +
        new Date()
          .toISOString()
          .replace(/\D/g, "")
          .slice(0, 14);

      // Default SLA = 6 hours
      const slaDeadline = new Date(
        Date.now() + 6 * 60 * 60 * 1000
      ).toISOString();

      // Create service request
      const {
        data: requestData,
        error: requestError,
      } = await supabase
        .from("service_requests")
        .insert({
          request_number: requestNumber,
          machine_id: selectedMachine,
          site_id: selectedSite,
          created_by: user.id,
          title: title.trim(),
          description: description.trim(),
          priority,
          status: "PENDING",
          required_skills: requiredSkills,
          sla_deadline: slaDeadline,
        })
        .select()
        .single();

      if (requestError) {
        throw requestError;
      }

      if (!requestData) {
        throw new Error(
          "Service request was created but no request data was returned."
        );
      }

      // Add creation log
      const {
        error: logError,
      } = await supabase
        .from("service_logs")
        .insert({
          service_request_id: requestData.id,
          action: "REQUEST_CREATED",
          description:
            "Service request created by Operations Manager.",
          created_by: user.id,
        });

      if (logError) {
        console.error(
          "REQUEST CREATION LOG ERROR:",
          logError
        );
      }

      // Automatically find and assign the best technician
      const {
        data: assignmentResult,
        error: assignmentError,
      } = await supabase.rpc(
        "auto_assign_service_request",
        {
          request_number_input: requestNumber,
        }
      );

      if (assignmentError) {
        console.error(
          "AUTO ASSIGNMENT ERROR:",
          assignmentError
        );

        Alert.alert(
          "Request Created",
          `${requestNumber} was created, but automatic technician assignment failed.\n\n${assignmentError.message}`,
          [
            {
              text: "OK",
              onPress: () => router.back(),
            },
          ]
        );

        return;
      }

      const assignment =
        assignmentResult?.[0];

      if (!assignment) {
        throw new Error(
          "Request was created, but no technician assignment was returned."
        );
      }

      Alert.alert(
        "Request Created & Assigned",
        `${requestNumber} has been created successfully.\n\nAssigned Technician: ${assignment.technician_name}\nMatch Score: ${Number(
          assignment.match_score
        ).toFixed(2)}`,
        [
          {
            text: "OK",
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error: any) {
      console.error(
        "CREATE REQUEST ERROR:",
        error
      );

      Alert.alert(
        "Creation Failed",
        error.message ||
          "Unable to create the service request."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
          color="#208AEF"
        />

        <Text style={styles.loadingText}>
          Loading request form...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Create Service Request
          </Text>

          <Text style={styles.headerSubtitle}>
            Automatic technician assignment enabled
          </Text>
        </View>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          disabled={submitting}
        >
          <Text style={styles.backText}>
            Back
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}

        <Text style={styles.label}>
          Request Title
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Example: Hydraulic Pressure Failure"
          placeholderTextColor="#777"
          value={title}
          onChangeText={setTitle}
        />

        {/* Description */}

        <Text style={styles.label}>
          Description
        </Text>

        <TextInput
          style={[
            styles.input,
            styles.textArea,
          ]}
          placeholder="Describe the equipment problem..."
          placeholderTextColor="#777"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        {/* Priority */}

        <Text style={styles.label}>
          Priority
        </Text>

        <View style={styles.optionRow}>
          {PRIORITIES.map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.optionButton,
                priority === item &&
                  styles.selectedOption,
              ]}
              onPress={() => setPriority(item)}
            >
              <Text
                style={[
                  styles.optionText,
                  priority === item &&
                    styles.selectedOptionText,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Site */}

        <Text style={styles.label}>
          Site
        </Text>

        {sites.map((site) => (
          <TouchableOpacity
            key={site.id}
            style={[
              styles.selectionCard,
              selectedSite === site.id &&
                styles.selectedCard,
            ]}
            onPress={() =>
              selectSite(site.id)
            }
          >
            <Text
              style={[
                styles.selectionTitle,
                selectedSite === site.id &&
                  styles.selectedText,
              ]}
            >
              {site.name}
            </Text>

            {site.location && (
              <Text style={styles.selectionSubtitle}>
                {site.location}
              </Text>
            )}
          </TouchableOpacity>
        ))}

        {/* Machine */}

        <Text style={styles.label}>
          Machine
        </Text>

        {!selectedSite ? (
          <Text style={styles.helperText}>
            Select a site first.
          </Text>
        ) : filteredMachines.length === 0 ? (
          <Text style={styles.helperText}>
            No machines found at this site.
          </Text>
        ) : (
          filteredMachines.map((machine) => (
            <TouchableOpacity
              key={machine.id}
              style={[
                styles.selectionCard,
                selectedMachine === machine.id &&
                  styles.selectedCard,
              ]}
              onPress={() =>
                setSelectedMachine(machine.id)
              }
            >
              <View style={styles.machineRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.selectionTitle,
                      selectedMachine ===
                        machine.id &&
                        styles.selectedText,
                    ]}
                  >
                    {machine.machine_code} —{" "}
                    {machine.name}
                  </Text>

                  {machine.machine_type && (
                    <Text style={styles.selectionSubtitle}>
                      {machine.machine_type}
                    </Text>
                  )}
                </View>

                <Text
                  style={[
                    styles.machineStatus,
                    machine.status ===
                      "OPERATIONAL" &&
                      styles.operational,
                  ]}
                >
                  {machine.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}

        {/* Required Skills */}

        <Text style={styles.label}>
          Required Skills
        </Text>

        <Text style={styles.helperText}>
          Select the skills required for this service.
        </Text>

        <View style={styles.skillsContainer}>
          {SKILLS.map((skill) => {
            const selected =
              requiredSkills.includes(skill);

            return (
              <TouchableOpacity
                key={skill}
                style={[
                  styles.skillButton,
                  selected &&
                    styles.selectedSkill,
                ]}
                onPress={() =>
                  toggleSkill(skill)
                }
              >
                <Text
                  style={[
                    styles.skillText,
                    selected &&
                      styles.selectedSkillText,
                  ]}
                >
                  {selected ? "✓ " : ""}
                  {skill}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* SLA */}

        <View style={styles.slaCard}>
          <Text style={styles.slaTitle}>
            SLA Deadline
          </Text>

          <Text style={styles.slaText}>
            6 hours from request creation
          </Text>

          <Text style={styles.slaSubtext}>
            The system will track this deadline for
            service monitoring.
          </Text>
        </View>

        {/* Auto Assignment Info */}

        <View style={styles.assignmentInfo}>
          <Text style={styles.assignmentInfoTitle}>
            ⚡ Automatic Technician Assignment
          </Text>

          <Text style={styles.assignmentInfoText}>
            After creation, EquipSync automatically
            evaluates technician skill match,
            availability, workload, and distance to
            select the best technician.
          </Text>
        </View>

        {/* Submit */}

        <TouchableOpacity
          style={[
            styles.createButton,
            submitting &&
              styles.disabledButton,
          ]}
          onPress={createRequest}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator
              color="#fff"
            />
          ) : (
            <Text style={styles.createButtonText}>
              Create & Auto-Assign Request
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0f14",
  },

  center: {
    flex: 1,
    backgroundColor: "#0b0f14",
    justifyContent: "center",
    alignItems: "center",
  },

  loadingText: {
    color: "#aaa",
    marginTop: 12,
    fontSize: 15,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 55,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#202832",
    backgroundColor: "#10161d",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },

  headerSubtitle: {
    color: "#7f8a96",
    fontSize: 13,
    marginTop: 4,
  },

  backButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: "#202832",
  },

  backText: {
    color: "#fff",
    fontWeight: "600",
  },

  content: {
    padding: 20,
  },

  label: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 9,
    marginTop: 18,
  },

  input: {
    backgroundColor: "#151c24",
    borderWidth: 1,
    borderColor: "#29333e",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#fff",
    fontSize: 15,
  },

  textArea: {
    minHeight: 120,
  },

  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  optionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#151c24",
    borderWidth: 1,
    borderColor: "#29333e",
  },

  selectedOption: {
    backgroundColor: "#208AEF",
    borderColor: "#208AEF",
  },

  optionText: {
    color: "#aab4bf",
    fontWeight: "600",
    fontSize: 13,
  },

  selectedOptionText: {
    color: "#fff",
  },

  selectionCard: {
    backgroundColor: "#151c24",
    borderWidth: 1,
    borderColor: "#29333e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },

  selectedCard: {
    borderColor: "#208AEF",
    backgroundColor: "#132235",
  },

  selectionTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },

  selectedText: {
    color: "#5db3ff",
  },

  selectionSubtitle: {
    color: "#7f8a96",
    fontSize: 12,
    marginTop: 4,
  },

  machineRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  machineStatus: {
    color: "#aab4bf",
    fontSize: 10,
    fontWeight: "700",
    marginLeft: 8,
  },

  operational: {
    color: "#44cc88",
  },

  helperText: {
    color: "#737e89",
    fontSize: 13,
    marginBottom: 4,
  },

  skillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  skillButton: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    backgroundColor: "#151c24",
    borderWidth: 1,
    borderColor: "#29333e",
    borderRadius: 8,
  },

  selectedSkill: {
    backgroundColor: "#163b5c",
    borderColor: "#208AEF",
  },

  skillText: {
    color: "#aab4bf",
    fontSize: 13,
    fontWeight: "600",
  },

  selectedSkillText: {
    color: "#fff",
  },

  slaCard: {
    marginTop: 22,
    padding: 16,
    borderRadius: 10,
    backgroundColor: "#151c24",
    borderWidth: 1,
    borderColor: "#29333e",
  },

  slaTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  slaText: {
    color: "#5db3ff",
    fontSize: 14,
    marginTop: 6,
    fontWeight: "600",
  },

  slaSubtext: {
    color: "#737e89",
    fontSize: 12,
    marginTop: 5,
    lineHeight: 18,
  },

  assignmentInfo: {
    marginTop: 12,
    padding: 16,
    borderRadius: 10,
    backgroundColor: "#132235",
    borderWidth: 1,
    borderColor: "#20527d",
  },

  assignmentInfoTitle: {
    color: "#5db3ff",
    fontSize: 15,
    fontWeight: "700",
  },

  assignmentInfoText: {
    color: "#aabbd0",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },

  createButton: {
    marginTop: 24,
    backgroundColor: "#208AEF",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },

  disabledButton: {
    opacity: 0.6,
  },

  createButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});