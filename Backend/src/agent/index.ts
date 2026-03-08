import axios from 'axios';
import { simulationEngine } from '../simulation/engine';
import { CORRIDORS } from '../simulation/routes';
import { SimulationState } from '../types';

const POLLINATION_API_URL = 'https://text.pollinations.ai/';

export class LogisticsAgent {

    async observe(): Promise<SimulationState> {
        return simulationEngine.getState();
    }

    async reason(state: SimulationState): Promise<string> {
        const prompt = `
You are a Logistics Operations Agent.
Analyze the following simulation state and identify anomalies or risks (delays, congestion, SLA breaches).
State: ${JSON.stringify(state)}
Provide a concise summary of risks and reasoning for each.
    `;
        try {
            const response = await axios.post(POLLINATION_API_URL, {
                messages: [{ role: 'user', content: prompt }],
                model: 'openai',
                stream: false
            });
            return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        } catch {
            return 'REASONING_UNAVAILABLE — using heuristic fallback.';
        }
    }

    async decide(reasoning: string): Promise<string[]> {
        const prompt = `
Based on this reasoning: "${reasoning}", 
Decide on 1-3 specific interventions. Format: "UPDATE_SHIPMENT:ID:STATUS"
    `;
        try {
            const response = await axios.post(POLLINATION_API_URL, {
                messages: [{ role: 'user', content: prompt }],
                model: 'openai',
                stream: false
            });
            const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            return text.split('\n').filter((l: string) => l.includes(':'));
        } catch {
            return [];
        }
    }

    async act(decisions: string[]) {
        decisions.forEach(decision => {
            const parts = decision.split(':');
            if (parts[0] === 'UPDATE_SHIPMENT') {
                const id = parts[1];
                const status = parts[2] as any;
                simulationEngine.updateShipmentStatus(id, status);
                simulationEngine.addEvent(`Agent: Updated shipment ${id} → ${status}.`);
            }
        });
    }

    /**
     * Rerouting Analysis: returns alternative routes + per-route reasoning for a given shipment.
     * Falls back to the static reasoning strings if Pollination API is unavailable.
     */
    async analyzeReroute(shipmentId: string): Promise<{ shipmentId: string; alternatives: any[] } | null> {
        const corridor = CORRIDORS[shipmentId];
        if (!corridor) return null;

        const state = simulationEngine.getState();
        const shipment = state.shipments.find(s => s.id === shipmentId);
        if (!shipment) return null;

        const alts = corridor.alternatives;

        // Try to enrich reasoning via Pollination (best-effort)
        const enrichedAlts = await Promise.all(alts.map(async alt => {
            const prompt = `
You are a logistics AI agent. A cargo shipment (${shipmentId}, priority: ${shipment.priority}) is considering this rerouting option:
Route Name: ${alt.name}
ETA impact: +${alt.etaDeltaHours} hours
Risk Score: ${alt.riskScore}
Pre-computed Reasoning: ${alt.reasoning}

Write a concise 2-3 sentence expert recommendation (pros/cons/final verdict) for the operations team.
      `;
            try {
                const res = await axios.post(POLLINATION_API_URL, {
                    messages: [{ role: 'user', content: prompt }],
                    model: 'openai',
                    stream: false
                });
                const enrichedReasoning = typeof res.data === 'string' ? res.data : alt.reasoning;
                return { ...alt, reasoning: enrichedReasoning };
            } catch {
                return alt; // fallback to static reasoning
            }
        }));

        return { shipmentId, alternatives: enrichedAlts };
    }

    async runStep() {
        const state = await this.observe();
        const reasoning = await this.reason(state);
        const decisions = await this.decide(reasoning);
        await this.act(decisions);
    }
}

export const agent = new LogisticsAgent();
