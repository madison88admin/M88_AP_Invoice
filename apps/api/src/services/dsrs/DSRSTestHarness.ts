/**
 * DSRS v2 - Test Harness
 * 
 * Validates DSRS performance against expected values
 * Tests on 10-50 invoices with ground truth comparison
 */

import { AmountResolver, AmountResolution } from './AmountResolver';
import { GraphDebugger } from './GraphDebugger';
import * as fs from 'fs';
import * as path from 'path';

export interface TestCase {
  invoiceId: string;
  text: string;
  expectedAmount?: number;
  expectedInvoiceNumber?: string;
  expectedQuantity?: number;
}

export interface TestResult {
  invoice: string;
  amount: {
    expected: number | undefined;
    predicted: number | null;
    correct: boolean;
    failure_type?: string;
  };
  graph_stats: {
    nodes: number;
    edges: number;
    avgDegree: number;
  };
  candidate_path: string[];
  confidence: number;
  explanation: string;
}

export class DSRSTestHarness {
  private amountResolver: AmountResolver;
  private results: TestResult[];

  constructor() {
    this.amountResolver = new AmountResolver();
    this.results = [];
  }

  /**
   * Run tests on a single invoice
   */
  async testInvoice(testCase: TestCase): Promise<TestResult> {
    console.log(`\n=== Testing Invoice: ${testCase.invoiceId} ===`);
    
    // Resolve amount using DSRS
    const resolution = this.amountResolver.resolve(testCase.text);
    const graph = this.amountResolver.getGraph();
    
    // Get graph statistics
    const summary = GraphDebugger.generateSummary(graph);
    
    // Determine correctness
    let correct = false;
    let failureType: string | undefined;
    
    if (testCase.expectedAmount !== undefined) {
      if (resolution.amount === null) {
        correct = false;
        failureType = 'NULL_AMOUNT';
      } else if (Math.abs(resolution.amount - testCase.expectedAmount) < 0.01) {
        correct = true;
      } else {
        correct = false;
        failureType = 'AMOUNT_MISMATCH';
      }
    }
    
    const result: TestResult = {
      invoice: testCase.invoiceId,
      amount: {
        expected: testCase.expectedAmount,
        predicted: resolution.amount,
        correct,
        failure_type: failureType
      },
      graph_stats: {
        nodes: summary.totalNodes,
        edges: summary.totalEdges,
        avgDegree: summary.avgDegree
      },
      candidate_path: resolution.path,
      confidence: resolution.confidence,
      explanation: resolution.explanation
    };
    
    this.results.push(result);
    
    // Log detailed results
    console.log(`Expected: ${testCase.expectedAmount}`);
    console.log(`Predicted: ${resolution.amount}`);
    console.log(`Correct: ${correct}`);
    console.log(`Confidence: ${(resolution.confidence * 100).toFixed(1)}%`);
    console.log(`Graph: ${summary.totalNodes} nodes, ${summary.totalEdges} edges`);
    
    if (!correct && failureType) {
      console.log(`Failure Type: ${failureType}`);
    }
    
    return result;
  }

  /**
   * Run tests on multiple invoices
   */
  async testBatch(testCases: TestCase[]): Promise<TestResult[]> {
    console.log(`\n=== Running DSRS Test Batch ===`);
    console.log(`Total invoices: ${testCases.length}`);
    
    this.results = [];
    
    for (const testCase of testCases) {
      await this.testInvoice(testCase);
    }
    
    this.generateSummary();
    return this.results;
  }

  /**
   * Generate test summary statistics
   */
  private generateSummary(): void {
    const total = this.results.length;
    const correct = this.results.filter(r => r.amount.correct).length;
    const incorrect = total - correct;
    const accuracy = total > 0 ? (correct / total) * 100 : 0;
    
    // Failure type breakdown
    const failureTypes = new Map<string, number>();
    for (const result of this.results) {
      if (!result.amount.correct && result.amount.failure_type) {
        failureTypes.set(
          result.amount.failure_type,
          (failureTypes.get(result.amount.failure_type) || 0) + 1
        );
      }
    }
    
    // Average graph statistics
    const avgNodes = this.results.reduce((sum, r) => sum + r.graph_stats.nodes, 0) / total;
    const avgEdges = this.results.reduce((sum, r) => sum + r.graph_stats.edges, 0) / total;
    const avgConfidence = this.results.reduce((sum, r) => sum + r.confidence, 0) / total;
    
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Total invoices: ${total}`);
    console.log(`Correct: ${correct} (${accuracy.toFixed(1)}%)`);
    console.log(`Incorrect: ${incorrect}`);
    console.log(`Average nodes: ${avgNodes.toFixed(1)}`);
    console.log(`Average edges: ${avgEdges.toFixed(1)}`);
    console.log(`Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    
    if (failureTypes.size > 0) {
      console.log('\n--- Failure Types ---');
      for (const [type, count] of failureTypes.entries()) {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    console.log('\n=== END TEST SUMMARY ===\n');
  }

  /**
   * Export results to JSON
   */
  exportResultsJSON(outputPath: string): void {
    const exportData = {
      timestamp: new Date().toISOString(),
      total_invoices: this.results.length,
      correct: this.results.filter(r => r.amount.correct).length,
      accuracy: this.results.length > 0 
        ? (this.results.filter(r => r.amount.correct).length / this.results.length) * 100 
        : 0,
      results: this.results
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`Results exported to: ${outputPath}`);
  }

  /**
   * Load test cases from directory
   */
  static loadTestCasesFromDirectory(directoryPath: string): TestCase[] {
    const testCases: TestCase[] = [];
    
    // Look for JSON files with expected values
    const files = fs.readdirSync(directoryPath);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(directoryPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        testCases.push({
          invoiceId: data.invoiceId || file.replace('.json', ''),
          text: data.text,
          expectedAmount: data.expectedAmount,
          expectedInvoiceNumber: data.expectedInvoiceNumber,
          expectedQuantity: data.expectedQuantity
        });
      }
    }
    
    return testCases;
  }

  /**
   * Create a simple test case from text
   */
  static createTestCase(invoiceId: string, text: string, expectedAmount?: number): TestCase {
    return {
      invoiceId,
      text,
      expectedAmount
    };
  }

  /**
   * Get current results
   */
  getResults(): TestResult[] {
    return this.results;
  }
}
