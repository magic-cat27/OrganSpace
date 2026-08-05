"""Organ connection graph — defines spatial and functional relationships.

Based on the Organ-Agents paper's 9-system model, augmented with anatomical knowledge.
"""

from dataclasses import dataclass, field

# The 9 organ systems from Organ-Agents paper Table 1
ORGAN_IDS = [
    "cardiovascular",
    "respiratory",
    "renal",
    "hepatic",
    "immune",
    "nervous",
    "blood",
    "coagulation",
    "metabolic",
]

ORGAN_NAMES = {
    "cardiovascular": "心血管系统",
    "respiratory": "呼吸系统",
    "renal": "肾脏系统",
    "hepatic": "肝脏系统",
    "immune": "免疫系统",
    "nervous": "神经系统",
    "blood": "血液系统",
    "coagulation": "凝血系统",
    "metabolic": "代谢与内分泌系统",
}

# Functional connections: organ_a ↔ organ_b with relationship description
# These define BOTH the 3D layout AND the impact propagation paths
CONNECTIONS: list[dict] = [
    # Heart-Lung axis
    {"a": "cardiovascular", "b": "respiratory", "relation": "心肺循环，氧气交换与血液泵送"},
    # Lung-Blood axis
    {"a": "respiratory", "b": "blood", "relation": "肺泡气体交换，血氧饱和度"},
    # Heart-Kidney axis
    {"a": "cardiovascular", "b": "renal", "relation": "心输出量决定肾灌注压；肾素-血管紧张素系统反馈"},
    # Kidney-Liver axis
    {"a": "renal", "b": "hepatic", "relation": "代谢废物清除；肝肾综合征"},
    # Kidney-Metabolic
    {"a": "renal", "b": "metabolic", "relation": "电解质平衡、酸碱调节、激素代谢"},
    # Liver-Metabolic
    {"a": "hepatic", "b": "metabolic", "relation": "糖脂代谢、蛋白合成、激素灭活"},
    # Heart-Metabolic
    {"a": "cardiovascular", "b": "metabolic", "relation": "循环输送激素与营养物质"},
    # Immune-Coagulation
    {"a": "immune", "b": "coagulation", "relation": "炎症激活凝血级联反应"},
    # Cardiovascular-Coagulation
    {"a": "cardiovascular", "b": "coagulation", "relation": "血流动力学影响血栓形成"},
    # Immune-Nervous
    {"a": "immune", "b": "nervous", "relation": "神经-免疫调控，应激反应"},
    # Nervous-Cardiovascular
    {"a": "nervous", "b": "cardiovascular", "relation": "自主神经调节心率与血压"},
    # Blood-Immune
    {"a": "blood", "b": "immune", "relation": "白细胞生成与免疫应答"},
    # Liver-Coagulation
    {"a": "hepatic", "b": "coagulation", "relation": "肝脏合成凝血因子"},
    # Blood-Coagulation
    {"a": "blood", "b": "coagulation", "relation": "血小板与凝血因子循环"},
    # Respiratory-Nervous
    {"a": "respiratory", "b": "nervous", "relation": "呼吸中枢调控"},
    # Metabolic-Nervous
    {"a": "metabolic", "b": "nervous", "relation": "激素对神经系统的调控"},
    # Renal-Blood
    {"a": "renal", "b": "blood", "relation": "促红细胞生成素(EPO)调节红细胞生成"},
]


@dataclass
class OrganGraph:
    """Manages organ connectivity for 3D layout and impact propagation."""

    connections: list[dict] = field(default_factory=lambda: CONNECTIONS.copy())

    def get_neighbors(self, organ_id: str) -> list[dict]:
        """Return all connected organs and their relationship descriptions."""
        neighbors = []
        for conn in self.connections:
            if conn["a"] == organ_id:
                neighbors.append({"organ": conn["b"], "relation": conn["relation"]})
            elif conn["b"] == organ_id:
                neighbors.append({"organ": conn["a"], "relation": conn["relation"]})
        return neighbors

    def get_connection_graph(self) -> dict:
        """Return full adjacency list for the frontend."""
        graph = {oid: [] for oid in ORGAN_IDS}
        for conn in self.connections:
            graph[conn["a"]].append(conn["b"])
            graph[conn["b"]].append(conn["a"])
        return graph

    def propagation_paths(self, source_organ: str, max_depth: int = 3) -> list[dict]:
        """BFS to find all organs reachable from source, with depth info.
        Returns list of {organ_id, depth, path, relation} dicts.
        """
        visited = {source_organ: 0}
        queue = [(source_organ, 0, [], "")]
        result = []

        while queue:
            current, depth, path, relation = queue.pop(0)
            if depth > 0:
                result.append({
                    "organ_id": current,
                    "depth": depth,
                    "path": path + [current],
                    "relation": relation,
                })
            if depth >= max_depth:
                continue
            for neighbor_info in self.get_neighbors(current):
                nb = neighbor_info["organ"]
                if nb not in visited or visited[nb] > depth + 1:
                    visited[nb] = depth + 1
                    queue.append((nb, depth + 1, path + [current], neighbor_info["relation"]))

        return sorted(result, key=lambda x: x["depth"])
