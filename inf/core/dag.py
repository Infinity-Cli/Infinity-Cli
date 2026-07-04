"""DAG scheduler and dependency resolver"""

from pydantic import BaseModel, Field
from typing import List
import networkx as nx


class TaskNode(BaseModel):
    """A single task/node in the DAG"""
    id: str
    type: str
    depends_on: List[str] = Field(default_factory=list)
    args: dict = Field(default_factory=dict)
    secrets_required: List[str] = Field(default_factory=list)


class DAG(BaseModel):
    """Directed Acyclic Graph for execution planning"""
    nodes: List[TaskNode]
    edges: List[dict] = Field(default_factory=list)

    def to_networkx(self) -> nx.DiGraph:
        """Convert DAG to NetworkX graph for processing"""
        graph = nx.DiGraph()
        for node in self.nodes:
            graph.add_node(node.id, **node.model_dump())
        for edge in self.edges:
            graph.add_edge(edge["from"], edge["to"])
        return graph

    def topological_sort(self) -> List[str]:
        """Return node IDs in execution order (respecting dependencies)"""
        graph = self.to_networkx()
        return list(nx.topological_sort(graph))

    def get_ready_tasks(self, completed: set) -> List[TaskNode]:
        """Get tasks ready to execute (all dependencies met)"""
        ready = []
        for node in self.nodes:
            if node.id not in completed:
                deps = set(node.depends_on)
                if not deps or deps.issubset(completed):
                    ready.append(node)
        return ready


class DAGScheduler:
    """Parse, validate, and schedule DAG execution"""

    def parse(self, dag_json: dict) -> DAG:
        """Parse JSON into DAG model"""
        return DAG(**dag_json)

    def extract_secrets(self, dag: DAG) -> List[str]:
        """Extract all required secrets from DAG"""
        secrets = set()
        for node in dag.nodes:
            secrets.update(node.secrets_required)
        return list(secrets)

    def validate(self, dag: DAG) -> bool:
        """Validate DAG structure (no cycles, valid dependencies)"""
        graph = dag.to_networkx()
        return nx.is_directed_acyclic_graph(graph)

    def get_execution_order(self, dag: DAG) -> List[str]:
        """Get ordered list of task IDs"""
        return dag.topological_sort()