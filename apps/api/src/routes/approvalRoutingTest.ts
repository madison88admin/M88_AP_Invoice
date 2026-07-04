import { Router, Request, Response } from 'express';
import { determineApprovalRoute } from '../services/approvalService';

const router = Router() as Router;

/**
 * GET /api/approval-routing-test/test
 * Test brand-tier → MLO Planning Manager routing with 5 scenarios
 */
router.get('/test', (req: Request, res: Response) => {
  const results = [];

  // Test Case 1: brand_code = "CSC" → Tier 2 TOP_10, routes to Edwin Garcia
  try {
    const route1 = determineApprovalRoute(6200, 'Columbia Sportswear', 'CSC');
    const roles1 = route1.map((r: any) => r.role);
    const planningManager1 = route1.find((r: any) => r.role === 'MLO_PLANNING_MANAGER')?.assignee_name;
    const expectedRoles1 = ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'];

    results.push({
      case: '1',
      description: 'brand_code = "CSC" → Tier 2 TOP_10, routes to Edwin Garcia',
      expected_roles: expectedRoles1,
      actual_roles: roles1,
      expected_planning_manager: 'Edwin Garcia',
      actual_planning_manager: planningManager1,
      planning_manager_correct: planningManager1 === 'Edwin Garcia',
      threw_exception: false,
      passed: JSON.stringify(roles1) === JSON.stringify(expectedRoles1) && planningManager1 === 'Edwin Garcia',
      full_route: route1
    });
  } catch (error: any) {
    results.push({
      case: '1',
      description: 'brand_code = "CSC" → Tier 2 TOP_10, routes to Edwin Garcia',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'],
      expected_planning_manager: 'Edwin Garcia',
      actual_planning_manager: 'ERROR',
      planning_manager_correct: false,
      threw_exception: true,
      passed: false,
      error_message: error.message
    });
  }

  // Test Case 2: brand_code = "PRN" → Tier 2 OTHER, routes to Glecie Yumena
  try {
    const route2 = determineApprovalRoute(5800, 'Prana', 'PRN');
    const roles2 = route2.map((r: any) => r.role);
    const planningManager2 = route2.find((r: any) => r.role === 'MLO_PLANNING_MANAGER')?.assignee_name;
    const expectedRoles2 = ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'];

    results.push({
      case: '2',
      description: 'brand_code = "PRN" → Tier 2 OTHER, routes to Glecie Yumena',
      expected_roles: expectedRoles2,
      actual_roles: roles2,
      expected_planning_manager: 'Glecie Yumena',
      actual_planning_manager: planningManager2,
      planning_manager_correct: planningManager2 === 'Glecie Yumena',
      threw_exception: false,
      passed: JSON.stringify(roles2) === JSON.stringify(expectedRoles2) && planningManager2 === 'Glecie Yumena',
      full_route: route2
    });
  } catch (error: any) {
    results.push({
      case: '2',
      description: 'brand_code = "PRN" → Tier 2 OTHER, routes to Glecie Yumena',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'],
      expected_planning_manager: 'Glecie Yumena',
      actual_planning_manager: 'ERROR',
      planning_manager_correct: false,
      threw_exception: true,
      passed: false,
      error_message: error.message
    });
  }

  // Test Case 3: brand_code = null/missing entirely → needsException=true, MISSING_BRAND_TIER exception
  try {
    const route3 = determineApprovalRoute(6200, undefined, undefined);
    results.push({
      case: '3',
      description: 'brand_code = null/missing entirely → MISSING_BRAND_TIER exception',
      expected: 'MISSING_BRAND_TIER exception',
      actual: 'NO EXCEPTION THROWN',
      threw_exception: false,
      passed: false
    });
  } catch (error: any) {
    results.push({
      case: '3',
      description: 'brand_code = null/missing entirely → MISSING_BRAND_TIER exception',
      expected: 'MISSING_BRAND_TIER exception',
      actual: error.message,
      threw_exception: true,
      passed: error.message.includes('No brand could be extracted')
    });
  }

  // Test Case 4: brand_code = "ZZZ" (truly unrecognized) → needsException=true, MISSING_BRAND_TIER exception
  try {
    const route4 = determineApprovalRoute(6200, 'Unknown Brand', 'ZZZ');
    results.push({
      case: '4',
      description: 'brand_code = "ZZZ" (truly unrecognized) → MISSING_BRAND_TIER exception',
      expected: 'MISSING_BRAND_TIER exception',
      actual: 'NO EXCEPTION THROWN',
      threw_exception: false,
      passed: false
    });
  } catch (error: any) {
    results.push({
      case: '4',
      description: 'brand_code = "ZZZ" (truly unrecognized) → MISSING_BRAND_TIER exception',
      expected: 'MISSING_BRAND_TIER exception',
      actual: error.message,
      threw_exception: true,
      passed: error.message.includes('Unrecognized brand code') && error.message.includes('ZZZ')
    });
  }

  // Test Case 5: Planning Tier invoice (amount <= $2,000) with any brand_code value, including null → no brand validation runs
  try {
    const route5 = determineApprovalRoute(2000, undefined, undefined);
    const roles5 = route5.map((r: any) => r.role);
    const expectedRoles5 = ['COORDINATOR', 'PURCHASING_MANAGER'];
    results.push({
      case: '5',
      description: 'Planning Tier invoice ($2,000) with null brand_code → no brand validation runs',
      expected_roles: expectedRoles5,
      actual_roles: roles5,
      expected: 'NO EXCEPTION (Planning Tier)',
      actual: 'NO EXCEPTION THROWN',
      threw_exception: false,
      passed: JSON.stringify(roles5) === JSON.stringify(expectedRoles5),
      full_route: route5
    });
  } catch (error: any) {
    results.push({
      case: '5',
      description: 'Planning Tier invoice ($2,000) with null brand_code → no brand validation runs',
      expected: 'NO EXCEPTION (Planning Tier)',
      actual: error.message,
      threw_exception: true,
      passed: false
    });
  }

  // Test Case 6: Planning Tier $1,500 → Coordinator + Purchasing Manager
  try {
    const route6 = determineApprovalRoute(1500, 'Test Brand', 'TST');
    const roles = route6.map((r: any) => r.role);
    const expectedRoles = ['COORDINATOR', 'PURCHASING_MANAGER'];
    results.push({
      case: '6',
      description: 'Planning Tier $1,500 → Coordinator + Purchasing Manager',
      expected_roles: expectedRoles,
      actual_roles: roles,
      passed: JSON.stringify(roles) === JSON.stringify(expectedRoles),
      full_route: route6
    });
  } catch (error: any) {
    results.push({
      case: '6',
      description: 'Planning Tier $1,500 → Coordinator + Purchasing Manager',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER'],
      actual_roles: 'ERROR',
      passed: false,
      error_message: error.message
    });
  }

  // Test Case 7: Tier 2 $3,000 TOP_10 → full route with MLO + SR Manager
  try {
    const route7 = determineApprovalRoute(3000, 'Columbia Sportswear', 'CSC');
    const roles = route7.map((r: any) => r.role);
    const planningManager7 = route7.find((r: any) => r.role === 'MLO_PLANNING_MANAGER')?.assignee_name;
    const expectedRoles = ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'];
    results.push({
      case: '7',
      description: 'Tier 2 $3,000 TOP_10 → Coordinator + Manager + MLO + SR Manager',
      expected_roles: expectedRoles,
      actual_roles: roles,
      expected_planning_manager: 'Edwin Garcia',
      actual_planning_manager: planningManager7,
      passed: JSON.stringify(roles) === JSON.stringify(expectedRoles) && planningManager7 === 'Edwin Garcia',
      full_route: route7
    });
  } catch (error: any) {
    results.push({
      case: '7',
      description: 'Tier 2 $3,000 TOP_10 → Coordinator + Manager + MLO + SR Manager',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'],
      actual_roles: 'ERROR',
      passed: false,
      error_message: error.message
    });
  }

  // Test Case 8: Tier 2 $45,000 TOP_10 → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager (Edwin) + Lindsey
  try {
    const route8 = determineApprovalRoute(45000, 'Columbia Sportswear', 'CSC');
    const roles = route8.map((r: any) => r.role);
    const planningManager = route8.find((r: any) => r.role === 'MLO_PLANNING_MANAGER')?.assignee_name;
    const expectedRoles = ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'];
    results.push({
      case: '8',
      description: 'Tier 2 $45,000 TOP_10 → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager (Edwin) + Lindsey',
      expected_roles: expectedRoles,
      actual_roles: roles,
      expected_planning_manager: 'Edwin Garcia',
      actual_planning_manager: planningManager,
      passed: JSON.stringify(roles) === JSON.stringify(expectedRoles) && planningManager === 'Edwin Garcia',
      full_route: route8
    });
  } catch (error: any) {
    results.push({
      case: '8',
      description: 'Tier 2 $45,000 TOP_10 → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager (Edwin) + Lindsey',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'],
      actual_roles: 'ERROR',
      expected_planning_manager: 'Edwin Garcia',
      actual_planning_manager: 'ERROR',
      passed: false,
      error_message: error.message
    });
  }

  // Test Case 9: Tier 2 $45,000 OTHER → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager (Glecie) + Lindsey
  try {
    const route9 = determineApprovalRoute(45000, 'Prana', 'PRN');
    const roles = route9.map((r: any) => r.role);
    const planningManager = route9.find((r: any) => r.role === 'MLO_PLANNING_MANAGER')?.assignee_name;
    const expectedRoles = ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'];
    results.push({
      case: '9',
      description: 'Tier 2 $45,000 OTHER → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager (Glecie) + Lindsey',
      expected_roles: expectedRoles,
      actual_roles: roles,
      expected_planning_manager: 'Glecie Yumena',
      actual_planning_manager: planningManager,
      passed: JSON.stringify(roles) === JSON.stringify(expectedRoles) && planningManager === 'Glecie Yumena',
      full_route: route9
    });
  } catch (error: any) {
    results.push({
      case: '9',
      description: 'Tier 2 $45,000 OTHER → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager (Glecie) + Lindsey',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION'],
      actual_roles: 'ERROR',
      expected_planning_manager: 'Glecie Yumena',
      actual_planning_manager: 'ERROR',
      passed: false,
      error_message: error.message
    });
  }

  // Test Case 10: Tier 3 $150,000 → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager + Lindsey + Polly
  try {
    const route10 = determineApprovalRoute(150000, 'Columbia Sportswear', 'CSC');
    const roles = route10.map((r: any) => r.role);
    const expectedRoles = ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY'];
    results.push({
      case: '10',
      description: 'Tier 3 $150,000 → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager + Lindsey + Polly',
      expected_roles: expectedRoles,
      actual_roles: roles,
      passed: JSON.stringify(roles) === JSON.stringify(expectedRoles),
      full_route: route10
    });
  } catch (error: any) {
    results.push({
      case: '10',
      description: 'Tier 3 $150,000 → Coordinator + Purchasing Manager + MLO Account Holder + MLO Planning Manager + Lindsey + Polly',
      expected_roles: ['COORDINATOR', 'PURCHASING_MANAGER', 'MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY'],
      actual_roles: 'ERROR',
      passed: false,
      error_message: error.message
    });
  }

  const summary = {
    total: 10,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };

  res.json(summary);
});

export default router;
