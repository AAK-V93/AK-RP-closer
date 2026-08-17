export interface QcBlockNote {
  whatHappened: string;
  whatScriptAsked: string;
  feedback: string;
  missingQuestion?: string;
}

export interface QcProspectQualification {
  problemCost: string;
  priorAttempts: string;
  moneyAlreadySpent: string;
  ownUrgency: string;
  decisionAuthority: string;
  offerFit: string;
}

export interface QcProspectFile {
  demographic: string;
  psychographic: string;
  qualification: QcProspectQualification;
  paymentCapacity: string;
  howOfferEntered: string;
  moneyFrame: string;
  paymentVerdict: string;
}

export interface QcDiscovery {
  discoveryPercent: number;
  pitchPercent: number;
  rapport: QcBlockNote;
  problemPain: QcBlockNote;
  pastSolutions: QcBlockNote;
  desiredSituation: QcBlockNote;
  blockScore: number;
}

export interface QcPitch {
  summary: string;
  blockScore: number;
}

export interface QcObjection {
  title: string;
  quote: string;
  timestamp: string;
  category: string;
  realRoot: string;
  howHandled: string;
  whyFailedOrWorked: string;
  principle: string;
  suggestedLine: string;
  prevention: string;
}

export interface QcDiscoveryFailure {
  title: string;
  whatWasMissed: string;
  howItFedObjection: string;
  principle: string;
  recommendation: string;
}

export interface QcProspectNotes {
  durationAndParticipants: string;
  whyBooked: string;
  problemAndPain: string[];
  currentSituation: string[];
  context: string;
  feelingsAndFears: string;
  currentEfforts: string[];
  pastSolutions: string[];
  timeAndUrgency: string;
  desires: string[];
  investmentAndDecider: string;
  programPresented: string;
  expectations: string;
  outcomeAndNextSteps: string;
  followUpAngle: string;
  reusableQuotes: string[];
}

export interface QcCallReport {
  headline: string;
  durationMinutes: number | null;
  sold: boolean;
  commitment: string;
  overallScore: number;
  prospectFile: QcProspectFile;
  discovery: QcDiscovery;
  pitch: QcPitch;
  objections: QcObjection[];
  rootObjection: string;
  missingAgreements: string[];
  discoveryFailures: QcDiscoveryFailure[];
  verdictLevers: string[];
  prospectNotes: QcProspectNotes;
  saved?: boolean;
  freeQcUsed?: boolean;
}
