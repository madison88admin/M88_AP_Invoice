/**
 * DSRS v2.5 - Tournament Amount Resolver
 * 
 * Replaces old AmountResolver with tournament-based resolution
 * Keeps old system as fallback if tournament fails
 */

import { Candidate, CandidateFactory, FieldType } from './Candidate';
import { FieldTournamentEngine, TournamentResult, DEFAULT_TOURNAMENT_CONFIG } from './FieldTournamentEngine';
import { GlobalCandidatePool, ExtractorOutput } from './GlobalCandidatePool';
import { CandidateGraphBuilder, CandidateGraph } from '../CandidateGraphBuilder';
import { AmountResolution } from '../AmountResolver';

export class TournamentAmountResolver {
  private candidatePool: GlobalCandidatePool;
  private tournamentEngine: FieldTournamentEngine;
  private graphBuilder: CandidateGraphBuilder;
  private useTournament: boolean;
  private fallbackResolver: any; // Old AmountResolver

  constructor(useTournament: boolean = true) {
    this.candidatePool = new GlobalCandidatePool();
    this.tournamentEngine = new FieldTournamentEngine(DEFAULT_TOURNAMENT_CONFIG);
    this.graphBuilder = new CandidateGraphBuilder();
    this.useTournament = useTournament;
    
    // Import old resolver as fallback
    // Note: This will be set externally to avoid circular dependency
    this.fallbackResolver = null;
  }

  /**
   * Set fallback resolver (old AmountResolver)
   */
  setFallbackResolver(resolver: any): void {
    this.fallbackResolver = resolver;
  }

  /**
   * Resolve amount using tournament or fallback
   */
  async resolve(text: string): Promise<AmountResolution> {
    console.log('[TournamentAmountResolver] Starting amount resolution');
    console.log(`[TournamentAmountResolver] Mode: ${this.useTournament ? 'TOURNAMENT' : 'FALLBACK'}`);

    if (this.useTournament) {
      try {
        return await this.resolveWithTournament(text);
      } catch (error) {
        console.error('[TournamentAmountResolver] Tournament failed, using fallback:', error);
        return this.resolveWithFallback(text);
      }
    } else {
      return this.resolveWithFallback(text);
    }
  }

  /**
   * Resolve amount using tournament engine
   */
  private async resolveWithTournament(text: string): Promise<AmountResolution> {
    console.log('[TournamentAmountResolver] Using tournament resolution');

    // Build graph for context
    const graph = this.graphBuilder.build(text);

    // Register amount extractor (adapter from old system)
    this.registerAmountExtractor(graph);

    // Extract candidates
    await this.candidatePool.extractFromText(text);

    // Get amount candidates
    const amountCandidates = this.candidatePool.getCandidates('amount');

    if (amountCandidates.length === 0) {
      console.log('[TournamentAmountResolver] No candidates found, using fallback');
      return this.resolveWithFallback(text);
    }

    // Run tournament
    const result = this.tournamentEngine.resolveField('amount', amountCandidates, graph);

    // Log tournament state
    this.tournamentEngine.logTournamentState('amount', amountCandidates);

    // Convert to AmountResolution format
    return this.convertToAmountResolution(result, amountCandidates);
  }

  /**
   * Register amount extractor (adapter from old system)
   */
  private registerAmountExtractor(graph: CandidateGraph): void {
    this.candidatePool.registerExtractor('amountExtractor', (text: string) => {
      const outputs: ExtractorOutput[] = [];

      // Extract amounts from graph
      const amountNodes = this.graphBuilder.getNodesByType('amount');
      
      for (const node of amountNodes) {
        const value = node.value as number;
        
        // Calculate initial scores
        const roleScore = this.calculateRoleScore(node, graph);
        const graphScore = this.calculateGraphScore(node, graph);
        const contextScore = this.calculateContextScore(node, graph);
        
        outputs.push({
          field: 'amount',
          value,
          source: 'amountExtractor',
          confidence: 0.5, // default confidence
          metadata: {
            position: node.position,
            contextWindow: node.context,
            isFromTable: this.isFromTable(node),
            isFromBank: this.isFromBank(node),
            ocrConfidence: node.ocrConfidence
          }
        });
      }

      return outputs;
    });
  }

  /**
   * Calculate role score for a node
   */
  private calculateRoleScore(node: any, graph: CandidateGraph): number {
    const context = node.context.toUpperCase();
    
    if (/(total|grand total|amount due|say total)/i.test(context)) {
      return 1.0;
    } else if (/subtotal/i.test(context)) {
      return 0.7;
    } else if (/(shipping|freight|postage)/i.test(context)) {
      return 0.2;
    }
    
    return 0.5;
  }

  /**
   * Calculate graph score for a node
   */
  private calculateGraphScore(node: any, graph: CandidateGraph): number {
    // Count connected edges
    let edgeCount = 0;
    for (const edge of graph.edges.values()) {
      if (edge.sourceId === node.id || edge.targetId === node.id) {
        edgeCount++;
      }
    }
    
    // Normalize to [0, 1]
    return Math.min(1.0, edgeCount / 5);
  }

  /**
   * Calculate context score for a node
   */
  private calculateContextScore(node: any, graph: CandidateGraph): number {
    const context = node.context.toUpperCase();
    let score = 0.5;
    
    if (context.includes('$')) score += 0.2;
    if (context.includes('TOTAL')) score += 0.2;
    if (context.includes('USD') || context.includes('HKD')) score += 0.1;
    
    return Math.min(1.0, score);
  }

  /**
   * Check if node is from table
   */
  private isFromTable(node: any): boolean {
    const context = node.context;
    const numbers = (context.match(/\d+/g) || []).length;
    return numbers > 2;
  }

  /**
   * Check if node is from bank section
   */
  private isFromBank(node: any): boolean {
    const context = node.context.toUpperCase();
    return context.includes('BANK') || context.includes('SWIFT') || context.includes('ACCOUNT');
  }

  /**
   * Resolve amount using fallback (old system)
   */
  private resolveWithFallback(text: string): AmountResolution {
    console.log('[TournamentAmountResolver] Using fallback resolution');
    
    if (this.fallbackResolver) {
      return this.fallbackResolver.resolve(text);
    }
    
    // If no fallback, return empty resolution
    return {
      amount: null,
      confidence: 0,
      path: [],
      explanation: 'No resolver available',
      rejectedCandidates: []
    };
  }

  /**
   * Convert tournament result to AmountResolution format
   */
  private convertToAmountResolution(
    result: TournamentResult,
    allCandidates: Candidate[]
  ): AmountResolution {
    const winner = result.winner;
    
    // Build path from score breakdown
    const path: string[] = [
      `Base: role=${result.scoreBreakdown.roleScore.toFixed(2)} graph=${result.scoreBreakdown.graphScore.toFixed(2)} context=${result.scoreBreakdown.contextScore.toFixed(2)} conf=${result.scoreBreakdown.confidence.toFixed(2)}`,
      `Modifiers: anchor=${result.scoreBreakdown.anchorBoost.toFixed(2)} structural=${result.scoreBreakdown.structuralBoost.toFixed(2)} noise=${result.scoreBreakdown.noisePenalty.toFixed(2)} consistency=${result.scoreBreakdown.consistencyBonus.toFixed(2)}`,
      `Global score: ${result.scoreBreakdown.globalScore.toFixed(3)}`,
      `Reason: ${winner.explanation}`
    ];

    // Build rejected candidates
    const rejectedCandidates = result.runnerUps.map((c: Candidate) => ({
      amount: c.value as number,
      reason: `Lower score (${c.globalScore.toFixed(3)}) vs winner (${winner.globalScore.toFixed(3)})`
    }));

    return {
      amount: winner.value as number,
      confidence: winner.globalScore,
      path,
      explanation: result.explanation,
      rejectedCandidates
    };
  }

  /**
   * Toggle tournament mode
   */
  setUseTournament(use: boolean): void {
    this.useTournament = use;
    console.log(`[TournamentAmountResolver] Tournament mode: ${use ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Get tournament engine for configuration
   */
  getTournamentEngine(): FieldTournamentEngine {
    return this.tournamentEngine;
  }

  /**
   * Get candidate pool for inspection
   */
  getCandidatePool(): GlobalCandidatePool {
    return this.candidatePool;
  }
}
