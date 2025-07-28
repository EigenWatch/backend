// src/common/interfaces/risk.interfaces.ts
export interface RiskResult {
  score: number;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface OperatorRiskResult {
  overallRiskScore: number;
  components: {
    onChainPerformance: RiskResult;
    economicBehavior: RiskResult;
    avsSelectionBehavior: RiskResult;
    networkPosition: RiskResult;
  };
  confidence: number;
  calculatedAt: Date;
}

export interface AVSRiskResult {
  overallRiskScore: number;
  components: {
    slashingBehavior: RiskResult;
    operatorAdoptionQuality: RiskResult;
    technicalComplexity: RiskResult;
    economicSustainability: RiskResult;
  };
  confidence: number;
  calculatedAt: Date;
}

// Extended subgraph interfaces
export interface OperatorCommissionEvent {
  id: string;
  operator: { id: string };
  commissionType: 'AVS_SPECIFIC' | 'PI_SPECIFIC' | 'OPERATOR_SET_SPECIFIC';
  oldCommissionBips: string;
  newCommissionBips: string;
  activatedAt: string;
  blockTimestamp: string;
  targetAVS?: { id: string };
  targetOperatorSet?: { id: string };
}

export interface OperatorSetMembership {
  id: string;
  operator: { id: string };
  operatorSet: { id: string; avs: { id: string } };
  joinedAt: string;
  leftAt?: string;
  isActive: boolean;
}

export interface DelegationStabilityData {
  totalDelegated: number;
  delegatorCount: number;
  volatilityCoefficient: number;
  growthRate: number;
  monthlyChanges: number[];
}
