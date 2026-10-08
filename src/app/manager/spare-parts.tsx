import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

type SparePart = {
  id: string;
  part_code: string;
  name: string;
  description: string | null;
  site_id: string;
  quantity: number;
  minimum_quantity: number;
  unit: string;
  sites?: {
    name: string;
  } | null;
};

export default function SparePartsScreen() {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadParts() {
    try {
      const { data, error } = await supabase
        .from("spare_parts")
        .select(`
          id,
          part_code,
          name,
          description,
          site_id,
          quantity,
          minimum_quantity,
          unit,
          sites (
            name
          )
        `)
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      setParts((data ?? []) as unknown as SparePart[]);
    } catch (error: any) {
      console.error("Failed to load spare parts:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadParts();
  }, []);

  function getStockStatus(part: SparePart) {
    if (part.quantity === 0) {
      return {
        label: "OUT OF STOCK",
        style: styles.outOfStock,
      };
    }

    if (part.quantity <= part.minimum_quantity) {
      return {
        label: "LOW STOCK",
        style: styles.lowStock,
      };
    }

    return {
      label: "AVAILABLE",
      style: styles.available,
    };
  }

  function onRefresh() {
    setRefreshing(true);
    loadParts();
  }

  function renderPart({ item }: { item: SparePart }) {
    const stock = getStockStatus(item);

    return (
      <View style={styles.card}>
        {/* CARD HEADER */}
        <View style={styles.cardHeader}>
          <View style={styles.titleContainer}>
            <Text style={styles.partName}>{item.name}</Text>

            <Text style={styles.partCode}>
              {item.part_code}
            </Text>
          </View>

          <View
            style={[
              styles.statusBadge,
              stock.style,
            ]}
          >
            <Text style={styles.statusText}>
              {stock.label}
            </Text>
          </View>
        </View>

        {/* DESCRIPTION */}
        {item.description ? (
          <Text style={styles.description}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.divider} />

        {/* INVENTORY INFORMATION */}
        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.label}>
              Available
            </Text>

            <Text style={styles.quantity}>
              {item.quantity} {item.unit}
            </Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.label}>
              Minimum
            </Text>

            <Text style={styles.value}>
              {item.minimum_quantity} {item.unit}
            </Text>
          </View>

          <View style={styles.siteContainer}>
            <Text style={styles.label}>
              Site
            </Text>

            <Text
              style={styles.value}
              numberOfLines={2}
            >
              {item.sites?.name || "Unknown"}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" />

        <Text style={styles.loadingText}>
          Loading spare parts...
        </Text>
      </SafeAreaView>
    );
  }

  const availableCount = parts.filter(
    (part) =>
      part.quantity > part.minimum_quantity
  ).length;

  const lowStockCount = parts.filter(
    (part) =>
      part.quantity > 0 &&
      part.quantity <= part.minimum_quantity
  ).length;

  const outOfStockCount = parts.filter(
    (part) => part.quantity === 0
  ).length;

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={parts}
        keyExtractor={(item) => item.id}
        renderItem={renderPart}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        }
        ListHeaderComponent={
          <View>
            {/* HEADER */}
            <View style={styles.header}>
              <Text style={styles.heading}>
                Spare Parts
              </Text>

              <Text style={styles.subtitle}>
                Equipment service inventory
              </Text>
            </View>

            {/* SUMMARY */}
            <View style={styles.summary}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryNumber}>
                  {parts.length}
                </Text>

                <Text style={styles.summaryLabel}>
                  Total Parts
                </Text>
              </View>

              <View style={styles.summaryBox}>
                <Text style={styles.summaryNumber}>
                  {availableCount}
                </Text>

                <Text style={styles.summaryLabel}>
                  Available
                </Text>
              </View>

              <View style={styles.summaryBox}>
                <Text style={styles.summaryNumber}>
                  {lowStockCount + outOfStockCount}
                </Text>

                <Text style={styles.summaryLabel}>
                  Attention
                </Text>
              </View>
            </View>

            {/* INVENTORY TITLE */}
            {parts.length > 0 && (
              <View style={styles.inventoryHeader}>
                <Text style={styles.inventoryTitle}>
                  Inventory
                </Text>

                <Text style={styles.inventoryCount}>
                  {parts.length} items
                </Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Text style={styles.emptyIconText}>
                📦
              </Text>
            </View>

            <Text style={styles.emptyTitle}>
              No spare parts found
            </Text>

            <Text style={styles.emptyText}>
              Add spare parts to your inventory
              to see them here.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f7fb",
  },

  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: "#6b7280",
  },

  /* HEADER */

  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
  },

  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#111827",
  },

  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#6b7280",
  },

  /* SUMMARY */

  summary: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },

  summaryBox: {
    flex: 1,
    minHeight: 86,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  summaryNumber: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
  },

  summaryLabel: {
    marginTop: 4,
    fontSize: 11,
    color: "#6b7280",
  },

  /* INVENTORY HEADER */

  inventoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },

  inventoryTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },

  inventoryCount: {
    fontSize: 12,
    color: "#6b7280",
  },

  /* LIST */

  list: {
    paddingBottom: 30,
  },

  /* CARD */

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },

  titleContainer: {
    flex: 1,
    paddingRight: 12,
  },

  partName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },

  partCode: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },

  /* STATUS */

  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
  },

  available: {
    backgroundColor: "#dcfce7",
  },

  lowStock: {
    backgroundColor: "#fef3c7",
  },

  outOfStock: {
    backgroundColor: "#fee2e2",
  },

  statusText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#374151",
  },

  /* DESCRIPTION */

  description: {
    marginTop: 11,
    fontSize: 13,
    lineHeight: 18,
    color: "#6b7280",
  },

  divider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 14,
  },

  /* INFORMATION */

  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  infoBlock: {
    minWidth: 92,
    paddingRight: 10,
  },

  label: {
    marginBottom: 4,
    fontSize: 11,
    color: "#9ca3af",
  },

  quantity: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },

  value: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: "#374151",
  },

  siteContainer: {
    flex: 1,
    paddingLeft: 4,
  },

  /* EMPTY */

  empty: {
    alignItems: "center",
    paddingHorizontal: 30,
    paddingTop: 55,
  },

  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  emptyIconText: {
    fontSize: 28,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#374151",
  },

  emptyText: {
    marginTop: 7,
    fontSize: 13,
    lineHeight: 19,
    color: "#9ca3af",
    textAlign: "center",
  },
});