"""Integration test for OrganSpace with DeepSeek."""
import os, sys, asyncio, json

# Clear any socks proxy
for var in list(os.environ.keys()):
    if 'proxy' in var.lower():
        val = os.getenv(var, '')
        if 'socks' in val.lower():
            del os.environ[var]

sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from config import DEEPSEEK_API_KEY, LLM_MODEL
from llm import LLMClient
from models.graph import OrganGraph
from agents.organs.cardiovascular import CardiovascularAgent
from agents.organs.respiratory import RespiratoryAgent
from agents.organs.renal import RenalAgent
from agents.organs.hepatic import HepaticAgent
from agents.organs.immune import ImmuneAgent
from agents.organs.nervous import NervousAgent
from agents.organs.blood import BloodAgent
from agents.organs.coagulation import CoagulationAgent
from agents.organs.metabolic import MetabolicAgent
from agents.orchestrator import Orchestrator

llm = LLMClient(provider='deepseek', api_key=DEEPSEEK_API_KEY)
graph = OrganGraph()

agent_classes = [
    CardiovascularAgent, RespiratoryAgent, RenalAgent,
    HepaticAgent, ImmuneAgent, NervousAgent,
    BloodAgent, CoagulationAgent, MetabolicAgent,
]

agents = {}
for cls in agent_classes:
    a = cls(llm, LLM_MODEL)
    a.set_neighbors(graph.get_neighbors(a.organ_id))
    agents[a.organ_id] = a

orch = Orchestrator(llm, LLM_MODEL, agents, graph)


async def main():
    print("=" * 60)
    print("Testing: 急性心肌梗死，患者胸痛伴大汗")
    print("=" * 60)
    r = await orch.simulate("急性心肌梗死，患者胸痛伴大汗")
    print(f"\nAffected organs: {[(o['name'], o['status']) for o in r['affected_organs']]}")
    print(f"\nSummary:\n{r['summary']}")
    print("\n✓ Full orchestrator flow works with DeepSeek!")

asyncio.run(main())
