// 模拟病患数据
export interface Patient {
  id: string;
  name: string;
  bedNumber: string;
  medicalRecordNumber: string; // 病例號碼
  age: number;
  gender: '男' | '女';  // 性別
  diagnosis: string;
  intubated: boolean;
  sedation: string[];  // S - Sedation
  analgesia: string[]; // A - Analgesia
  nmb: string[];       // N - Neuromuscular Blocker
  admissionDate: string;
  icuAdmissionDate: string;  // ICU 入住日期
  ventilatorDays: number;    // 呼吸器使用天數
  attendingPhysician: string; // 主治醫師
  department: '內科-李穎灝' | '內科-黃英哲' | '外科';  // 科別與醫師
  lastUpdate: string;
  alerts: string[];
  consentStatus: 'valid' | 'expired' | 'none';
  hasUnreadMessages?: boolean; // 是否有未讀留言
  hasDNR: boolean; // 有無DNR
  isIsolated: boolean; // 有無隔離
}

// 檢驗數據歷史趨勢
export interface LabTrendDataPoint {
  date: string;
  value: number;
}

// 檢驗數據類型定義
export interface LabData {
  timestamp: string;
  biochemistry: {
    Na?: number;
    K?: number;
    Cl?: number;
    BUN?: number;
    Scr?: number;
    eGFR?: number;
    Clcr?: number;
    Glucose?: number;
    Ca?: number;
    freeCa?: number;
    Mg?: number;
    P?: number;
    TBil?: number;
    DBil?: number;
    AST?: number;
    ALT?: number;
    ALP?: number;
    Alb?: number;
    INR?: number;
  };
  hematology: {
    WBC?: number;
    RBC?: number;
    Hb?: number;
    Hct?: number;
    MCV?: number;
    MCH?: number;
    MCHC?: number;
    PLT?: number;
    Segment?: number;
    Lymph?: number;
  };
  bloodGas: {
    pH?: number;
    PCO2?: number;
    PO2?: number;
    HCO3?: number;
    Lactate?: number;
    BE?: number;
  };
  inflammatory: {
    CRP?: number;
    PCT?: number;
  };
  coagulation: {
    PT?: number;
    aPTT?: number;
    DDimer?: number;
  };
  cardiac?: {
    TnT?: number;
    CKMB?: number;
    CK?: number;
    NTproBNP?: number;
  };
  lipid?: {
    TCHO?: number;
    TG?: number;
    LDLC?: number;
    HDLC?: number;
    UA?: number;
    P?: number;
  };
  other?: {
    HbA1C?: number;
    LDH?: number;
    NH3?: number;
    Amylase?: number;
    Lipase?: number;
  };
  thyroid?: {
    TSH?: number;
    freeT4?: number;
  };
  hormone?: {
    Cortisol?: number;
  };
}

// 檢驗數據歷史趨勢 - 模擬7個時間點的數據
export const mockLabTrendData: Record<string, LabTrendDataPoint[]> = {
  eGFR: [
    { date: '2024-01-15', value: 28 },
    { date: '2024-03-20', value: 26 },
    { date: '2024-05-10', value: 25 },
    { date: '2024-07-05', value: 22 },
    { date: '2024-09-12', value: 19 },
    { date: '2024-10-18', value: 18 },
    { date: '2024-11-21', value: 16 }
  ],
  Scr: [
    { date: '2024-01-15', value: 1.8 },
    { date: '2024-03-20', value: 1.9 },
    { date: '2024-05-10', value: 2.0 },
    { date: '2024-07-05', value: 2.2 },
    { date: '2024-09-12', value: 2.5 },
    { date: '2024-10-18', value: 2.7 },
    { date: '2024-11-21', value: 1.2 }
  ],
  K: [
    { date: '2024-01-15', value: 4.2 },
    { date: '2024-03-20', value: 3.9 },
    { date: '2024-05-10', value: 3.7 },
    { date: '2024-07-05', value: 3.5 },
    { date: '2024-09-12', value: 3.3 },
    { date: '2024-10-18', value: 3.1 },
    { date: '2024-11-21', value: 3.2 }
  ],
  Na: [
    { date: '2024-01-15', value: 142 },
    { date: '2024-03-20', value: 141 },
    { date: '2024-05-10', value: 140 },
    { date: '2024-07-05', value: 139 },
    { date: '2024-09-12', value: 138 },
    { date: '2024-10-18', value: 137 },
    { date: '2024-11-21', value: 138 }
  ],
  WBC: [
    { date: '2024-01-15', value: 8.2 },
    { date: '2024-03-20', value: 9.5 },
    { date: '2024-05-10', value: 11.2 },
    { date: '2024-07-05', value: 13.8 },
    { date: '2024-09-12', value: 15.2 },
    { date: '2024-10-18', value: 14.5 },
    { date: '2024-11-21', value: 12.5 }
  ],
  Hb: [
    { date: '2024-01-15', value: 12.8 },
    { date: '2024-03-20', value: 12.2 },
    { date: '2024-05-10', value: 11.5 },
    { date: '2024-07-05', value: 10.8 },
    { date: '2024-09-12', value: 10.2 },
    { date: '2024-10-18', value: 10.0 },
    { date: '2024-11-21', value: 10.2 }
  ],
  CRP: [
    { date: '2024-01-15', value: 5.2 },
    { date: '2024-03-20', value: 8.5 },
    { date: '2024-05-10', value: 12.8 },
    { date: '2024-07-05', value: 18.5 },
    { date: '2024-09-12', value: 22.3 },
    { date: '2024-10-18', value: 19.8 },
    { date: '2024-11-21', value: 15.2 }
  ],
  Lactate: [
    { date: '2024-01-15', value: 1.2 },
    { date: '2024-03-20', value: 1.5 },
    { date: '2024-05-10', value: 1.8 },
    { date: '2024-07-05', value: 2.2 },
    { date: '2024-09-12', value: 2.8 },
    { date: '2024-10-18', value: 3.2 },
    { date: '2024-11-21', value: 2.5 }
  ],
  BUN: [
    { date: '2024-01-15', value: 18 },
    { date: '2024-03-20', value: 22 },
    { date: '2024-05-10', value: 25 },
    { date: '2024-07-05', value: 28 },
    { date: '2024-09-12', value: 32 },
    { date: '2024-10-18', value: 30 },
    { date: '2024-11-21', value: 28 }
  ],
  Alb: [
    { date: '2024-01-15', value: 3.8 },
    { date: '2024-03-20', value: 3.6 },
    { date: '2024-05-10', value: 3.4 },
    { date: '2024-07-05', value: 3.2 },
    { date: '2024-09-12', value: 3.0 },
    { date: '2024-10-18', value: 3.1 },
    { date: '2024-11-21', value: 3.2 }
  ],
  PLT: [
    { date: '2024-01-15', value: 220 },
    { date: '2024-03-20', value: 210 },
    { date: '2024-05-10', value: 195 },
    { date: '2024-07-05', value: 188 },
    { date: '2024-09-12', value: 180 },
    { date: '2024-10-18', value: 182 },
    { date: '2024-11-21', value: 185 }
  ],
  Cl: [
    { date: '2024-01-15', value: 105 },
    { date: '2024-03-20', value: 104 },
    { date: '2024-05-10', value: 103 },
    { date: '2024-07-05', value: 102 },
    { date: '2024-09-12', value: 102 },
    { date: '2024-10-18', value: 101 },
    { date: '2024-11-21', value: 102 }
  ],
  Ca: [
    { date: '2024-01-15', value: 9.2 },
    { date: '2024-03-20', value: 9.0 },
    { date: '2024-05-10', value: 8.9 },
    { date: '2024-07-05', value: 8.8 },
    { date: '2024-09-12', value: 8.7 },
    { date: '2024-10-18', value: 8.8 },
    { date: '2024-11-21', value: 8.8 }
  ],
  freeCa: [
    { date: '2024-01-15', value: 1.22 },
    { date: '2024-03-20', value: 1.20 },
    { date: '2024-05-10', value: 1.19 },
    { date: '2024-07-05', value: 1.18 },
    { date: '2024-09-12', value: 1.17 },
    { date: '2024-10-18', value: 1.18 },
    { date: '2024-11-21', value: 1.18 }
  ],
  Mg: [
    { date: '2024-01-15', value: 2.0 },
    { date: '2024-03-20', value: 1.95 },
    { date: '2024-05-10', value: 1.92 },
    { date: '2024-07-05', value: 1.90 },
    { date: '2024-09-12', value: 1.88 },
    { date: '2024-10-18', value: 1.90 },
    { date: '2024-11-21', value: 1.9 }
  ],
  RBC: [
    { date: '2024-01-15', value: 4.2 },
    { date: '2024-03-20', value: 4.0 },
    { date: '2024-05-10', value: 3.9 },
    { date: '2024-07-05', value: 3.8 },
    { date: '2024-09-12', value: 3.8 },
    { date: '2024-10-18', value: 3.8 },
    { date: '2024-11-21', value: 3.8 }
  ],
  Hct: [
    { date: '2024-01-15', value: 35.2 },
    { date: '2024-03-20', value: 33.8 },
    { date: '2024-05-10', value: 32.5 },
    { date: '2024-07-05', value: 31.2 },
    { date: '2024-09-12', value: 30.5 },
    { date: '2024-10-18', value: 30.3 },
    { date: '2024-11-21', value: 30.5 }
  ],
  MCV: [
    { date: '2024-11-21', value: 88 }
  ],
  MCH: [
    { date: '2024-11-21', value: 29 }
  ],
  MCHC: [
    { date: '2024-11-21', value: 33 }
  ],
  Segment: [
    { date: '2024-01-15', value: 72 },
    { date: '2024-03-20', value: 75 },
    { date: '2024-05-10', value: 76 },
    { date: '2024-07-05', value: 78 },
    { date: '2024-09-12', value: 79 },
    { date: '2024-10-18', value: 78 },
    { date: '2024-11-21', value: 78 }
  ],
  Lymph: [
    { date: '2024-01-15', value: 22 },
    { date: '2024-03-20', value: 20 },
    { date: '2024-05-10', value: 18 },
    { date: '2024-07-05', value: 16 },
    { date: '2024-09-12', value: 15 },
    { date: '2024-10-18', value: 16 },
    { date: '2024-11-21', value: 16 }
  ],
  PCT: [
    { date: '2024-01-15', value: 0.8 },
    { date: '2024-03-20', value: 1.2 },
    { date: '2024-05-10', value: 1.8 },
    { date: '2024-07-05', value: 2.5 },
    { date: '2024-09-12', value: 3.2 },
    { date: '2024-10-18', value: 2.8 },
    { date: '2024-11-21', value: 2.2 }
  ],
  DDimer: [
    { date: '2024-01-15', value: 0.8 },
    { date: '2024-03-20', value: 1.2 },
    { date: '2024-05-10', value: 1.5 },
    { date: '2024-07-05', value: 1.8 },
    { date: '2024-09-12', value: 2.2 },
    { date: '2024-10-18', value: 2.0 },
    { date: '2024-11-21', value: 1.8 }
  ],
  pH: [
    { date: '2024-01-15', value: 7.38 },
    { date: '2024-03-20', value: 7.37 },
    { date: '2024-05-10', value: 7.36 },
    { date: '2024-07-05', value: 7.35 },
    { date: '2024-09-12', value: 7.34 },
    { date: '2024-10-18', value: 7.35 },
    { date: '2024-11-21', value: 7.36 }
  ],
  PCO2: [
    { date: '2024-01-15', value: 40 },
    { date: '2024-03-20', value: 42 },
    { date: '2024-05-10', value: 43 },
    { date: '2024-07-05', value: 45 },
    { date: '2024-09-12', value: 46 },
    { date: '2024-10-18', value: 45 },
    { date: '2024-11-21', value: 44 }
  ],
  PO2: [
    { date: '2024-01-15', value: 92 },
    { date: '2024-03-20', value: 88 },
    { date: '2024-05-10', value: 86 },
    { date: '2024-07-05', value: 85 },
    { date: '2024-09-12', value: 83 },
    { date: '2024-10-18', value: 84 },
    { date: '2024-11-21', value: 85 }
  ],
  HCO3: [
    { date: '2024-01-15', value: 24 },
    { date: '2024-03-20', value: 23.5 },
    { date: '2024-05-10', value: 23 },
    { date: '2024-07-05', value: 22.5 },
    { date: '2024-09-12', value: 22 },
    { date: '2024-10-18', value: 22.5 },
    { date: '2024-11-21', value: 23 }
  ],
  BE: [
    { date: '2024-01-15', value: 0 },
    { date: '2024-03-20', value: -1 },
    { date: '2024-05-10', value: -1.5 },
    { date: '2024-07-05', value: -2 },
    { date: '2024-09-12', value: -2.5 },
    { date: '2024-10-18', value: -2 },
    { date: '2024-11-21', value: -1.5 }
  ],
  AST: [
    { date: '2024-01-15', value: 28 },
    { date: '2024-03-20', value: 30 },
    { date: '2024-05-10', value: 31 },
    { date: '2024-07-05', value: 32 },
    { date: '2024-09-12', value: 33 },
    { date: '2024-10-18', value: 32 },
    { date: '2024-11-21', value: 32 }
  ],
  ALT: [
    { date: '2024-01-15', value: 25 },
    { date: '2024-03-20', value: 26 },
    { date: '2024-05-10', value: 27 },
    { date: '2024-07-05', value: 28 },
    { date: '2024-09-12', value: 29 },
    { date: '2024-10-18', value: 28 },
    { date: '2024-11-21', value: 28 }
  ],
  TBil: [
    { date: '2024-01-15', value: 0.7 },
    { date: '2024-03-20', value: 0.75 },
    { date: '2024-05-10', value: 0.8 },
    { date: '2024-07-05', value: 0.85 },
    { date: '2024-09-12', value: 0.9 },
    { date: '2024-10-18', value: 0.88 },
    { date: '2024-11-21', value: 0.9 }
  ],
  DBil: [
    { date: '2024-11-21', value: 0.3 }
  ],
  ALP: [
    { date: '2024-01-15', value: 72 },
    { date: '2024-03-20', value: 74 },
    { date: '2024-05-10', value: 76 },
    { date: '2024-07-05', value: 78 },
    { date: '2024-09-12', value: 78 },
    { date: '2024-10-18', value: 78 },
    { date: '2024-11-21', value: 78 }
  ],
  INR: [
    { date: '2024-01-15', value: 1.0 },
    { date: '2024-03-20', value: 1.05 },
    { date: '2024-05-10', value: 1.08 },
    { date: '2024-07-05', value: 1.1 },
    { date: '2024-09-12', value: 1.12 },
    { date: '2024-10-18', value: 1.1 },
    { date: '2024-11-21', value: 1.1 }
  ],
  Clcr: [
    { date: '2024-01-15', value: 32 },
    { date: '2024-03-20', value: 30 },
    { date: '2024-05-10', value: 28 },
    { date: '2024-07-05', value: 26 },
    { date: '2024-09-12', value: 24 },
    { date: '2024-10-18', value: 25 },
    { date: '2024-11-21', value: 26 }
  ],
  Glucose: [
    { date: '2024-01-15', value: 120 },
    { date: '2024-03-20', value: 132 },
    { date: '2024-05-10', value: 138 },
    { date: '2024-07-05', value: 145 },
    { date: '2024-09-12', value: 148 },
    { date: '2024-10-18', value: 145 },
    { date: '2024-11-21', value: 145 }
  ],
  PT: [
    { date: '2024-11-21', value: 12.5 }
  ],
  aPTT: [
    { date: '2024-11-21', value: 32 }
  ],
  TnT: [
    { date: '2024-11-21', value: 0.05 }
  ],
  CKMB: [
    { date: '2024-11-21', value: 15 }
  ],
  CK: [
    { date: '2024-11-21', value: 120 }
  ],
  NTproBNP: [
    { date: '2024-11-21', value: 1200 }
  ],
  TCHO: [
    { date: '2024-11-21', value: 180 }
  ],
  TG: [
    { date: '2024-11-21', value: 150 }
  ],
  LDLC: [
    { date: '2024-11-21', value: 110 }
  ],
  HDLC: [
    { date: '2024-11-21', value: 45 }
  ],
  UA: [
    { date: '2024-11-21', value: 6.5 }
  ],
  P: [
    { date: '2024-11-21', value: 3.5 }
  ],
  HbA1C: [
    { date: '2024-11-21', value: 6.8 }
  ],
  LDH: [
    { date: '2024-11-21', value: 220 }
  ],
  NH3: [
    { date: '2024-11-21', value: 45 }
  ],
  Amylase: [
    { date: '2024-11-21', value: 85 }
  ],
  Lipase: [
    { date: '2024-11-21', value: 50 }
  ],
  TSH: [
    { date: '2024-11-21', value: 2.5 }
  ],
  freeT4: [
    { date: '2024-11-21', value: 1.2 }
  ],
  Cortisol: [
    { date: '2024-11-21', value: 15 }
  ],
  // 生命徵象
  RespiratoryRate: [
    { date: '2024-01-15', value: 16 },
    { date: '2024-03-20', value: 18 },
    { date: '2024-05-10', value: 20 },
    { date: '2024-07-05', value: 22 },
    { date: '2024-09-12', value: 24 },
    { date: '2024-10-18', value: 26 },
    { date: '2024-11-21', value: 28 }
  ],
  Temperature: [
    { date: '2024-01-15', value: 36.5 },
    { date: '2024-03-20', value: 36.8 },
    { date: '2024-05-10', value: 37.2 },
    { date: '2024-07-05', value: 37.5 },
    { date: '2024-09-12', value: 37.8 },
    { date: '2024-10-18', value: 38.0 },
    { date: '2024-11-21', value: 38.2 }
  ],
  BloodPressure: [
    { date: '2024-01-15', value: 128 },
    { date: '2024-03-20', value: 125 },
    { date: '2024-05-10', value: 122 },
    { date: '2024-07-05', value: 118 },
    { date: '2024-09-12', value: 115 },
    { date: '2024-10-18', value: 114 },
    { date: '2024-11-21', value: 112 }
  ],
  HeartRate: [
    { date: '2024-01-15', value: 72 },
    { date: '2024-03-20', value: 68 },
    { date: '2024-05-10', value: 62 },
    { date: '2024-07-05', value: 58 },
    { date: '2024-09-12', value: 52 },
    { date: '2024-10-18', value: 48 },
    { date: '2024-11-21', value: 46 }
  ]
};

// 檢驗項目參考範圍
export const labReferenceRanges: Record<string, string> = {
  eGFR: '≥60',
  Scr: '0.7-1.3',
  K: '3.5-5.0',
  Na: '135-145',
  Cl: '96-106',
  Ca: '8.5-10.5',
  freeCa: '1.15-1.29',
  Mg: '1.7-2.2',
  WBC: '4.0-10.0',
  RBC: '4.5-5.5',
  Hb: '13.5-17.5',
  Hct: '40-52',
  MCV: '80-100',
  MCH: '27-31',
  MCHC: '32-36',
  PLT: '150-400',
  Segment: '40-74',
  Lymph: '20-45',
  Alb: '3.5-5.0',
  CRP: '<5.0',
  PCT: '<0.5',
  DDimer: '<0.5',
  PT: '9.5-13.5',
  aPTT: '25-35',
  pH: '7.35-7.45',
  PCO2: '35-45',
  PO2: '80-100',
  HCO3: '22-26',
  BE: '-2 to +2',
  Lactate: '<2.0',
  AST: '5-40',
  ALT: '7-56',
  TBil: '0.3-1.2',
  DBil: '<0.3',
  ALP: '30-120',
  INR: '0.8-1.2',
  BUN: '7-20',
  Clcr: '≥60',
  Glucose: '70-100',
  TnT: '<0.01',
  CKMB: '<25',
  CK: '24-195',
  NTproBNP: '<125',
  TCHO: '<200',
  TG: '<150',
  LDLC: '<130',
  HDLC: '>40',
  UA: '3.5-7.2',
  P: '2.5-4.5',
  HbA1C: '<5.7',
  LDH: '120-246',
  NH3: '11-35',
  Amylase: '30-110',
  Lipase: '13-60',
  TSH: '0.4-4.0',
  freeT4: '0.9-1.7',
  Cortisol: '5-25',
  // 生命徵象
  RespiratoryRate: '12-20',
  Temperature: '36.5-37.5',
  BloodPressure: '90-140',
  HeartRate: '60-100'
};

// 檢驗項目中文名稱
export const labChineseNames: Record<string, string> = {
  Na: '鈉離子',
  K: '鉀離子',
  Cl: '氯離子',
  Ca: '鈣離子',
  freeCa: '游離鈣',
  Mg: '鎂離子',
  P: '磷',
  WBC: '白血球',
  RBC: '紅血球',
  Hb: '血紅素',
  Hct: '血球容積比',
  MCV: '平均紅血球容積',
  MCH: '平均紅血球血紅素',
  MCHC: '平均紅血球血紅素濃度',
  PLT: '血小板',
  Segment: '嗜中性球',
  Lymph: '淋巴球',
  Alb: '白蛋白',
  CRP: 'C反應蛋白',
  PCT: '前降鈣素',
  DDimer: 'D-雙聚體',
  PT: '凝血酶原時間',
  aPTT: '部分凝血活酶時間',
  pH: '酸鹼值',
  PCO2: '二氧化碳分壓',
  PO2: '氧分壓',
  HCO3: '碳酸氫根',
  BE: '鹼基過剩',
  Lactate: '乳酸',
  AST: '天門冬胺酸轉胺酶',
  ALT: '丙胺酸轉胺酶',
  TBil: '總膽紅素',
  DBil: '直接膽紅素',
  ALP: '鹼性磷酸酶',
  INR: '國際標準化比值',
  BUN: '血中尿素氮',
  Scr: '肌酸酐',
  eGFR: '腎絲球過濾率',
  Clcr: '肌酸酐清除率',
  Glucose: '血糖',
  TnT: '肌鈣蛋白T',
  CKMB: '肌酸激酶同功酶MB',
  CK: '肌酸激酶',
  NTproBNP: 'NT-proBNP',
  TCHO: '總膽固醇',
  TG: '三酸甘油酯',
  LDLC: '低密度脂蛋白膽固醇',
  HDLC: '高密度脂蛋白膽固醇',
  UA: '尿酸',
  HbA1C: '糖化血色素',
  LDH: '乳酸脫氫酶',
  NH3: '血氨',
  Amylase: '澱粉酶',
  Lipase: '脂肪酶',
  TSH: '甲狀腺刺激素',
  freeT4: '游離甲狀腺素',
  Cortisol: '皮質醇',
  // 生命徵象
  RespiratoryRate: '呼吸頻率',
  Temperature: '體溫',
  BloodPressure: '血壓',
  HeartRate: '心跳'
};

export const mockPatients: Patient[] = [
  {
    id: '1',
    name: '張三',
    bedNumber: 'I-1',
    medicalRecordNumber: '123456',
    age: 65,
    gender: '男',
    diagnosis: '重度肺炎併呼吸衰竭',
    intubated: true,
    sedation: ['Dormicum'],
    analgesia: ['Morphine'],
    nmb: [],
    admissionDate: '2025-10-15',
    icuAdmissionDate: '2025-10-17',
    ventilatorDays: 6,
    attendingPhysician: '李穎灝',
    department: '內科-李穎灝',
    lastUpdate: '2025-10-22 08:30',
    alerts: ['血鉀偏低'],
    consentStatus: 'valid',
    hasUnreadMessages: true,
    hasDNR: false,
    isIsolated: false
  },
  {
    id: '2',
    name: '李四',
    bedNumber: 'I-2',
    medicalRecordNumber: '123457',
    age: 58,
    gender: '男',
    diagnosis: '敗血性休克併多重器官衰竭',
    intubated: true,
    sedation: ['Propofol'],
    analgesia: ['Fentanyl'],
    nmb: ['Cisatracurium'],
    admissionDate: '2025-10-18',
    icuAdmissionDate: '2025-10-19',
    ventilatorDays: 4,
    attendingPhysician: '李穎灝',
    department: '內科-李穎灝',
    lastUpdate: '2025-10-23 07:15',
    alerts: ['血壓偏低', 'QT間期延長'],
    consentStatus: 'valid',
    hasUnreadMessages: true,
    hasDNR: false,
    isIsolated: true
  },
  {
    id: '3',
    name: '王五',
    bedNumber: 'I-3',
    medicalRecordNumber: '123458',
    age: 72,
    gender: '女',
    diagnosis: '急性腎衰竭併肺水腫',
    intubated: true,
    sedation: ['Dexmedetomidine'],
    analgesia: ['Morphine'],
    nmb: [],
    admissionDate: '2025-10-12',
    icuAdmissionDate: '2025-10-13',
    ventilatorDays: 10,
    attendingPhysician: '黃英哲',
    department: '內科-黃英哲',
    lastUpdate: '2025-10-23 08:00',
    alerts: ['腎功能不全', '電解質異常'],
    consentStatus: 'expired',
    hasUnreadMessages: false,
    hasDNR: true,
    isIsolated: false
  },
  {
    id: '4',
    name: '趙六',
    bedNumber: 'I-4',
    medicalRecordNumber: '123459',
    age: 45,
    gender: '男',
    diagnosis: '創傷性腦損傷',
    intubated: false,
    sedation: [],
    analgesia: [],
    nmb: [],
    admissionDate: '2025-10-20',
    icuAdmissionDate: '2025-10-20',
    ventilatorDays: 0,
    attendingPhysician: '李穎灝',
    department: '外科',
    lastUpdate: '2025-10-23 09:00',
    alerts: [],
    consentStatus: 'valid',
    hasUnreadMessages: false,
    hasDNR: false,
    isIsolated: false
  }
];

// 用藥記錄
export interface Medication {
  id: string;
  patientId: string;
  name: string;
  dose: string;
  route: string;
  frequency: string;
  category: 'S' | 'A' | 'N' | 'other';
  startDate: string;
  status: 'active' | 'discontinued';
}

export const mockMedications: Medication[] = [
  {
    id: 'med1',
    patientId: '1',
    name: 'Morphine',
    dose: '2mg',
    route: 'IV',
    frequency: 'q4h prn',
    category: 'A',
    startDate: '2025-10-17',
    status: 'active'
  },
  {
    id: 'med2',
    patientId: '1',
    name: 'Dormicum',
    dose: '2mg',
    route: 'IV',
    frequency: 'q4h prn',
    category: 'S',
    startDate: '2025-10-17',
    status: 'active'
  },
  {
    id: 'med3',
    patientId: '2',
    name: 'Propofol',
    dose: '50mg/hr',
    route: 'IV infusion',
    frequency: 'continuous',
    category: 'S',
    startDate: '2025-10-19',
    status: 'active'
  },
  {
    id: 'med4',
    patientId: '2',
    name: 'Fentanyl',
    dose: '50mcg/hr',
    route: 'IV infusion',
    frequency: 'continuous',
    category: 'A',
    startDate: '2025-10-19',
    status: 'active'
  },
  {
    id: 'med5',
    patientId: '2',
    name: 'Cisatracurium',
    dose: '2mg/hr',
    route: 'IV infusion',
    frequency: 'continuous',
    category: 'N',
    startDate: '2025-10-19',
    status: 'active'
  },
  {
    id: 'med6',
    patientId: '3',
    name: 'Dexmedetomidine',
    dose: '0.5mcg/kg/hr',
    route: 'IV infusion',
    frequency: 'continuous',
    category: 'S',
    startDate: '2025-10-13',
    status: 'active'
  },
  {
    id: 'med7',
    patientId: '3',
    name: 'Morphine',
    dose: '2mg',
    route: 'IV',
    frequency: 'q6h prn',
    category: 'A',
    startDate: '2025-10-13',
    status: 'active'
  }
];

// 用藥建議代碼與類型
export type MedicationAdviceCode = 
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' 
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W';

export const ADVICE_TYPE_MAP: Record<MedicationAdviceCode, string> = {
  'A': '藥品調劑與給藥',
  'B': '適應症問題',
  'C': '藥品過敏或不良反應',
  'D': '藥品重複',
  'E': '藥品交互作用',
  'F': '劑量過高/過低',
  'G': '藥品相容性',
  'H': '其他',
  'I': '健保用藥規範',
  'J': '劑量調整建議',
  'K': '停藥或療程評估',
  'L': '劑型或給藥途徑',
  'M': '藥品替代建議',
  'N': '不良反應監測',
  'O': '預防性用藥',
  'P': '療程長度建議',
  'Q': '營養支持',
  'R': '藥物濃度監測',
  'S': '藥物副作用監測',
  'T': 'TDM 建議',
  'U': '藥歷查核',
  'V': '自備藥辨識',
  'W': '用藥衛教'
};

// 新的用藥建議分類結構（對應工作台的四大類）
export interface AdviceCategory {
  label: string;
  codes: { code: string; label: string }[];
}

export const ADVICE_CATEGORIES: Record<string, AdviceCategory> = {
  prescription: {
    label: '1. 建議處方',
    codes: [
      { code: '1-1', label: '建議更適當用藥/配方組成' },
      { code: '1-2', label: '用藥途徑或劑型問題' },
      { code: '1-3', label: '用藥期間/數量問題（包含停藥）' },
      { code: '1-4', label: '用藥劑量/頻次問題' },
      { code: '1-5', label: '不符健保給付規定' },
      { code: '1-6', label: '其他' },
      { code: '1-7', label: '藥品相容性問題' },
      { code: '1-8', label: '疑似藥品不良反應' },
      { code: '1-9', label: '藥品交互作用' },
      { code: '1-10', label: '藥品併用問題' },
      { code: '1-11', label: '用藥替急問題（包括過敏史）' },
      { code: '1-12', label: '適應症問題' },
      { code: '1-13', label: '給藥問題（途徑、輸注方式、濃度或稀釋液）' }
    ]
  },
  proactive: {
    label: '2. 主動建議',
    codes: [
      { code: '2-1', label: '建議靜脈營養配方' },
      { code: '2-2', label: '建議藥物治療療程' },
      { code: '2-3', label: '建議用藥/建議增加用藥' },
      { code: '2-4', label: '藥品不良反應評估' }
    ]
  },
  monitoring: {
    label: '3. 建議監測',
    codes: [
      { code: '3-1', label: '建議藥品濃度監測' },
      { code: '3-2', label: '建議藥品不良反應監測' },
      { code: '3-3', label: '建議藥品療效監測' }
    ]
  },
  appropriateness: {
    label: '4. 用藥適從性',
    codes: [
      { code: '4-1', label: '病人用藥適從性問題' },
      { code: '4-2', label: '藥品辨識/自備藥辨識' },
      { code: '4-3', label: '藥歷查核與整合' }
    ]
  }
};

// 用藥建議記錄介面
export interface PharmacyAdviceRecord {
  id: string;
  patientId: string;
  patientName: string;
  bedNumber: string;
  adviceCode: string; // 1-1, 1-2, 2-1, etc.
  adviceLabel: string; // 完整描述
  category: string; // '1. 建議處方', '2. 主動建議', etc.
  content: string; // 建議內容
  pharmacistName: string;
  timestamp: string;
  linkedMedications?: string[]; // 關聯藥品
}

// 全域用藥建議儲存（模擬資料庫）
export const pharmacyAdviceRecords: PharmacyAdviceRecord[] = [
  {
    id: 'adv-1',
    patientId: '1',
    patientName: '陳大明',
    bedNumber: 'A-101',
    adviceCode: '1-4',
    adviceLabel: '用藥劑量/頻次問題',
    category: '1. 建議處方',
    content: '病患腎功能 eGFR 45 ml/min，建議 Vancomycin 劑量調整為 1g Q24H，並監測血中濃度。',
    pharmacistName: '王藥師',
    timestamp: '2025-01-09 14:30',
    linkedMedications: ['Vancomycin']
  },
  {
    id: 'adv-2',
    patientId: '2',
    patientName: '林小華',
    bedNumber: 'A-102',
    adviceCode: '1-9',
    adviceLabel: '藥品交互作用',
    category: '1. 建議處方',
    content: 'Warfarin 與 Amiodarone 併用可能增加出血風險，建議密切監測 INR 值。',
    pharmacistName: '李藥師',
    timestamp: '2025-01-09 10:15',
    linkedMedications: ['Warfarin', 'Amiodarone']
  },
  {
    id: 'adv-3',
    patientId: '3',
    patientName: '張美玲',
    bedNumber: 'B-203',
    adviceCode: '3-1',
    adviceLabel: '建議藥品濃度監測',
    category: '3. 建議監測',
    content: '建議監測 Vancomycin trough level，目標濃度 15-20 mcg/mL。',
    pharmacistName: '陳藥師',
    timestamp: '2025-01-08 16:45',
    linkedMedications: ['Vancomycin']
  },
  {
    id: 'adv-4',
    patientId: '1',
    patientName: '陳大明',
    bedNumber: 'A-101',
    adviceCode: '1-7',
    adviceLabel: '藥品相容性問題',
    category: '1. 建議處方',
    content: 'Furosemide 與 Gentamicin 不建議於同一條 IV line 給藥，建議分開給藥。',
    pharmacistName: '王藥師',
    timestamp: '2025-01-08 09:20',
    linkedMedications: ['Furosemide', 'Gentamicin']
  },
  {
    id: 'adv-5',
    patientId: '4',
    patientName: '黃志強',
    bedNumber: 'C-305',
    adviceCode: '2-3',
    adviceLabel: '建議用藥/建議增加用藥',
    category: '2. 主動建議',
    content: '病患有壓力性潰瘍風險，建議加上 Pantoprazole 40mg QD 預防用藥。',
    pharmacistName: '陳藥師',
    timestamp: '2025-01-07 15:30',
    linkedMedications: []
  }
];

// 病患留言板資料
export interface PatientMessage {
  id: string;
  patientId: string;
  authorName: string;
  authorRole: 'doctor' | 'nurse' | 'pharmacist' | 'admin';
  messageType: 'general' | 'medication-advice' | 'alert';
  content: string;
  timestamp: string;
  isRead: boolean;
  linkedMedication?: string; // 關聯的藥品
  adviceCode?: MedicationAdviceCode; // 用藥建議代碼（僅用於 medication-advice）
}

// AI 對話記錄
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  references?: string[]; // AI 回應的參考來源
}

export interface ChatSession {
  id: string;
  patientId: string;
  sessionDate: string; // 對話日期 YYYY-MM-DD
  sessionTime: string; // 對話時間 HH:mm
  title: string; // 對話標題
  messages: ChatMessage[];
  lastUpdated: string; // 最後更新時間
  labDataSnapshot?: {
    K?: number;
    Na?: number;
    Scr?: number;
    eGFR?: number;
    CRP?: number;
    WBC?: number;
  }; // 當時的檢驗數據快照
}

export const mockChatSessions: ChatSession[] = [
  {
    id: 'chat1',
    patientId: '1',
    sessionDate: '2025-11-14',
    sessionTime: '14:30',
    title: '鎮靜深度評估與血鉀討論',
    messages: [
      {
        role: 'user',
        content: '這位病患的鎮靜深度是否適當？',
        timestamp: '2025-11-14 14:30'
      },
      {
        role: 'assistant',
        content: '根據病患目前的檢驗數據與用藥狀況，我建議您注意以下幾點：\n\n1. 目前使用 Morphine 與 Dormicum 併用，RASS 評分建議維持在 -1 到 -2 之間。\n2. 需注意呼吸抑制與過度鎮靜的風險。\n3. 建議每日評估鎮靜深度（RASS 評分）並適時調整劑量。\n\n**所有輸出內容仍需依據您的專業判斷審慎評估與使用。**',
        timestamp: '2025-11-14 14:31'
      },
      {
        role: 'user',
        content: '血鉀 3.2 需要如何處理？',
        timestamp: '2025-11-14 14:32'
      },
      {
        role: 'assistant',
        content: '血鉀值 3.2 mmol/L 碰識偏低，建議處理方式：\n\n1. 立即補充 KCl 20-40 mEq (依腎功能調整)\n2. 每 4-6 小時追蹤血鉀值\n3. 評估是否有使用利尿劑或其他可能造成低血鉀的藥物\n4. 若持續偏低，可考慮調整補充速率\n\n**請依據病患整體狀況與腎功能調整補充劑量。**',
        timestamp: '2025-11-14 14:33'
      }
    ],
    lastUpdated: '2025-11-14 14:33',
    labDataSnapshot: {
      K: 3.2,
      Na: 138,
      Scr: 1.2,
      eGFR: 58,
      CRP: 8.5,
      WBC: 12.5
    }
  },
  {
    id: 'chat2',
    patientId: '1',
    sessionDate: '2025-11-13',
    sessionTime: '09:15',
    title: '呼吸器參數調整諮詢',
    messages: [
      {
        role: 'user',
        content: '病患目前呼吸器設定是否適當？',
        timestamp: '2025-11-13 09:15'
      },
      {
        role: 'assistant',
        content: '根據動脈血氣分析結果：\n\npH: 7.35, PCO2: 45, PO2: 85\n\n目前略呈現輕度呼吸性酸中毒，建議：\n1. 可考慮微調呼吸速率或潮氣量\n2. 監測 PCO2 變化\n3. 評估是否需要調整 PEEP\n\n**請依臨床狀況判斷調整幅度。**',
        timestamp: '2025-11-13 09:16'
      }
    ],
    lastUpdated: '2025-11-13 09:16',
    labDataSnapshot: {
      K: 3.5,
      Na: 140,
      Scr: 1.1,
      eGFR: 62
    }
  }
];

export const mockPatientMessages: PatientMessage[] = [
  {
    id: 'msg1',
    patientId: '1',
    authorName: '林藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議監測血鉀並補充 KCl，目前 K: 3.2 偏低。Morphine 劑量可維持，但需注意與 Dormicum 併用的呼吸抑制風險。',
    timestamp: '2025-10-23 09:15',
    isRead: false,
    linkedMedication: 'Morphine',
    adviceCode: 'E'
  },
  {
    id: 'msg2',
    patientId: '1',
    authorName: '陳醫師',
    authorRole: 'doctor',
    messageType: 'general',
    content: '今日查房發現病患鎮靜深度較深（RASS -3），建議調降 Dormicum 劑量。',
    timestamp: '2025-10-23 08:30',
    isRead: false
  },
  {
    id: 'msg_today1',
    patientId: '2',
    authorName: '張護理師',
    authorRole: 'nurse',
    messageType: 'general',
    content: '病患昨夜躁動，已調整 Propofol 輸注速率，目前鎮靜評估 RASS -2，請��師評估。',
    timestamp: '2025-10-23 07:20',
    isRead: true
  },
  {
    id: 'msg_today2',
    patientId: '3',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議調整抗生素療程，目前 Ceftriaxone 使用已達 7 天，培養結果顯示敏感性良好，可考慮降階治療。',
    timestamp: '2025-10-23 10:45',
    isRead: false,
    adviceCode: 'K'
  },
  {
    id: 'msg_today3',
    patientId: '4',
    authorName: '李醫師',
    authorRole: 'doctor',
    messageType: 'alert',
    content: '請注意病患今晨血壓偏低（85/50），已調整升壓藥物劑量，持續監測中。',
    timestamp: '2025-10-23 06:30',
    isRead: true
  },
  {
    id: 'msg3',
    patientId: '2',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: 'Propofol 與 Fentanyl 需使用不同輸注管路，避免配伍不相容。Cisatracurium 使用中需監測 TOF。',
    timestamp: '2025-10-23 11:20',
    isRead: false,
    linkedMedication: 'Propofol',
    adviceCode: 'G'
  },
  {
    id: 'msg4',
    patientId: '2',
    authorName: '張護理師',
    authorRole: 'nurse',
    messageType: 'alert',
    content: '注意：病患 QT 間期延長，使用鎮靜劑時需特別留意心律變化。',
    timestamp: '2025-10-23 14:20',
    isRead: false
  },
  {
    id: 'msg5',
    patientId: '3',
    authorName: '李藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患腎功能不全（eGFR 32），Morphine 需減量使用，建議間隔延長至 q4-6h，密切監測鎮靜與呼吸狀態。',
    timestamp: '2025-10-21 14:30',
    isRead: false,
    linkedMedication: 'Morphine',
    adviceCode: 'J'
  },
  {
    id: 'msg6',
    patientId: '1',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議監測 Propofol Infusion Syndrome 相關指標（CK、Lactate、TG），目前使用劑量偏高且持續時間較長。',
    timestamp: '2025-10-20 16:20',
    isRead: true,
    adviceCode: 'S'
  },
  {
    id: 'msg7',
    patientId: '2',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: 'Fentanyl 建議改為經由中心靜脈輸注，避免外周靜脈炎發生。',
    timestamp: '2025-10-19 11:30',
    isRead: true,
    adviceCode: 'A'
  },
  {
    id: 'msg8',
    patientId: '3',
    authorName: '陳藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議監測 Vancomycin 血中濃度，確保療效並降低腎毒性風險。',
    timestamp: '2025-10-18 09:45',
    isRead: true,
    adviceCode: 'T'
  },
  {
    id: 'msg9',
    patientId: '4',
    authorName: '林藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患使用 Phenytoin 但無適應症記載，建議確認使用目的是否為癲癇預防。',
    timestamp: '2025-10-17 14:20',
    isRead: true,
    adviceCode: 'B'
  },
  {
    id: 'msg10',
    patientId: '1',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患有 Penicillin 過敏史，建議更換 Ampicillin 為其他抗生素如 Levofloxacin。',
    timestamp: '2025-10-16 10:30',
    isRead: true,
    adviceCode: 'C'
  },
  {
    id: 'msg11',
    patientId: '2',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議將 Heparin 5000 units TID SC 改為體重調整劑量，以降低出血風險。',
    timestamp: '2025-10-15 16:45',
    isRead: true,
    adviceCode: 'J'
  },
  {
    id: 'msg12',
    patientId: '3',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: 'Gentamicin 使用已達 7 天，建議評估是否可停藥或調整治療計畫。',
    timestamp: '2025-10-14 11:20',
    isRead: true,
    adviceCode: 'K'
  },
  {
    id: 'msg13',
    patientId: '1',
    authorName: '陳藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議評估 Metformin 使用適當性，病患 eGFR < 30，應考慮停用或改用其他降血糖藥。',
    timestamp: '2025-10-13 09:15',
    isRead: true,
    adviceCode: 'F'
  },
  {
    id: 'msg_extra1',
    patientId: '2',
    authorName: '張藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議增加 Pantoprazole 預防壓力性潰瘍，病患有多項風險因子。',
    timestamp: '2025-10-12 15:30',
    isRead: true,
    adviceCode: 'O'
  },
  {
    id: 'msg_extra2',
    patientId: '3',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議調整靜脈營養配方，增加蛋白質含量以改善營養狀態。',
    timestamp: '2025-10-11 10:15',
    isRead: true,
    adviceCode: 'Q'
  },
  {
    id: 'msg_extra3',
    patientId: '1',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '查核藥歷發現病患長期使用 Warfarin，需注意與目前抗生素的交互作用。',
    timestamp: '2025-10-10 14:45',
    isRead: true,
    adviceCode: 'U'
  },
  {
    id: 'msg_extra4',
    patientId: '4',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '協助辨識自備藥品，確認為 Aspirin 100mg，已納入用藥記錄。',
    timestamp: '2025-10-09 11:20',
    isRead: true,
    adviceCode: 'V'
  },
  {
    id: 'msg14',
    patientId: '4',
    authorName: '李藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患使用 Ceftriaxone 超過健保給付規定天數，建議確認是否有特殊適應症。',
    timestamp: '2025-10-12 15:30',
    isRead: true,
    adviceCode: 'I'
  },
  {
    id: 'msg15',
    patientId: '2',
    authorName: '林藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議將 Aspirin 從口服改為靜脈製劑，病患目前無法經口進食。',
    timestamp: '2025-10-11 08:40',
    isRead: true,
    adviceCode: 'L'
  },
  {
    id: 'msg16',
    patientId: '3',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議評估是否可以使用 TPN（全靜脈營養），病患已禁食超過 5 天。',
    timestamp: '2025-10-10 13:50',
    isRead: true,
    adviceCode: 'Q'
  },
  {
    id: 'msg17',
    patientId: '1',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患同時使用 Warfarin 與 Aspirin，建議監測 INR 與出血徵象。',
    timestamp: '2025-10-09 10:25',
    isRead: true,
    adviceCode: 'D'
  },
  {
    id: 'msg18',
    patientId: '4',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議監測 Digoxin 血中濃度並評估療效，病患有腎功能不全。',
    timestamp: '2025-10-08 14:15',
    isRead: true,
    adviceCode: 'R'
  },
  {
    id: 'msg19',
    patientId: '1',
    authorName: '張藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議改用 Esomeprazole 取代 Omeprazole，考量病患有 CYP2C19 基因多型性。',
    timestamp: '2025-10-22 16:20',
    isRead: true,
    adviceCode: 'M'
  },
  {
    id: 'msg20',
    patientId: '2',
    authorName: '陳藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患出現皮疹，疑似 Vancomycin 不良反應，建議評估藥品與症狀的因果關係。',
    timestamp: '2025-10-22 11:30',
    isRead: true,
    adviceCode: 'N'
  },
  {
    id: 'msg21',
    patientId: '3',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議 Meropenem 抗生素療程為 7-14 天，目前已使用 5 天，請評估療效後決定總療程。',
    timestamp: '2025-10-21 09:45',
    isRead: true,
    adviceCode: 'P'
  },
  {
    id: 'msg22',
    patientId: '4',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患家屬反應病患在家經常忘記服藥，建議加強用藥衛教與遵從性評估。',
    timestamp: '2025-10-20 14:50',
    isRead: true,
    adviceCode: 'W'
  },
  {
    id: 'msg23',
    patientId: '1',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議調整 Propofol 稀釋濃度至 10mg/mL，以降低輸注管路堵塞風險。',
    timestamp: '2025-10-19 10:15',
    isRead: true,
    adviceCode: 'A'
  },
  {
    id: 'msg24',
    patientId: '2',
    authorName: '李藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '其他建議：請確認 Insulin 使用筆型或針筒注射，以避免劑量誤差。',
    timestamp: '2025-10-18 15:30',
    isRead: true,
    adviceCode: 'H'
  },
  {
    id: 'msg25',
    patientId: '3',
    authorName: '林藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患血糖控制不佳，建議增加 Insulin 劑量或調整使用時機。',
    timestamp: '2025-10-17 13:20',
    isRead: true,
    adviceCode: 'J'
  },
  {
    id: 'msg26',
    patientId: '4',
    authorName: '張藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議評估停用 Carvedilol，病患血壓與心率已穩定，可考慮減量或停藥。',
    timestamp: '2025-10-16 11:45',
    isRead: true,
    adviceCode: 'K'
  },
  {
    id: 'msg27',
    patientId: '1',
    authorName: '陳藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '藥品交互作用：Amiodarone 與 Warfarin 併用可能增加出血風險，建議調整 Warfarin 劑量。',
    timestamp: '2025-10-15 09:30',
    isRead: true,
    adviceCode: 'E'
  },
  {
    id: 'msg28',
    patientId: '2',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '藥品相容性問題：Furosemide 與 Calcium 不可混合於同一靜脈輸液中，建議分開投予。',
    timestamp: '2025-10-14 16:10',
    isRead: true,
    adviceCode: 'G'
  },
  {
    id: 'msg29',
    patientId: '3',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議監測 Phenytoin 不良反應，特別注意牙齦增生、眼球震顫等症狀。',
    timestamp: '2025-10-13 14:25',
    isRead: true,
    adviceCode: 'S'
  },
  {
    id: 'msg30',
    patientId: '4',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '病患有 Sulfa 類過敏史，請避免使用 Sulfamethoxazole/Trimethoprim。',
    timestamp: '2025-10-12 10:50',
    isRead: true,
    adviceCode: 'C'
  },
  {
    id: 'msg31',
    patientId: '1',
    authorName: '李藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '適應症問題：Ondansetron 使用頻率過高，建議評估噁心嘔吐原因並調整用藥策略。',
    timestamp: '2025-10-11 15:15',
    isRead: true,
    adviceCode: 'B'
  },
  {
    id: 'msg32',
    patientId: '2',
    authorName: '張藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '疑似 Vancomycin 引起紅人症候群（Red Man Syndrome），建議調降輸注速率至至少 60 分鐘。',
    timestamp: '2025-10-10 11:40',
    isRead: true,
    adviceCode: 'F'
  },
  {
    id: 'msg33',
    patientId: '3',
    authorName: '陳藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議增加深部靜脈血栓預防用藥（Enoxaparin），病患有多項危險因子。',
    timestamp: '2025-10-09 09:20',
    isRead: true,
    adviceCode: 'O'
  },
  {
    id: 'msg34',
    patientId: '4',
    authorName: '劉藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '建議監測 Theophylline 血中濃度，目標範圍 10-20 mcg/mL，以確保療效與安全性。',
    timestamp: '2025-10-08 13:55',
    isRead: true,
    adviceCode: 'T'
  },
  {
    id: 'msg35',
    patientId: '1',
    authorName: '王藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '藥歷查核：病患先前住院曾使用 Carbamazepine，需注意藥物交互作用與過敏史。',
    timestamp: '2025-10-07 10:30',
    isRead: true,
    adviceCode: 'U'
  },
  {
    id: 'msg36',
    patientId: '2',
    authorName: '周藥師',
    authorRole: 'pharmacist',
    messageType: 'medication-advice',
    content: '協助辨識自備藥：確認為 Metformin 500mg，已核對病歷並納入用藥記錄。',
    timestamp: '2025-10-06 14:45',
    isRead: true,
    adviceCode: 'V'
  }
];

// 藥物交互作用數據
export interface DrugInteraction {
  id: string;
  drugA: string;
  drugB: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references?: string;
}

export const mockDrugInteractions: DrugInteraction[] = [
  {
    id: 'int1',
    drugA: 'Warfarin',
    drugB: 'Amiodarone',
    severity: 'high',
    description: 'Amiodarone 會增強 Warfarin 的抗凝血作用',
    mechanism: 'Amiodarone 抑制 CYP2C9 酵素，減少 Warfarin 代謝',
    clinicalEffect: '增加出血風險，INR 值可能顯著上升',
    management: '併用時需密切監測 INR，通常需將 Warfarin 劑量減少 30-50%',
    references: 'Micromedex, UpToDate'
  },
  {
    id: 'int2',
    drugA: 'Morphine',
    drugB: 'Midazolam',
    severity: 'medium',
    description: '兩者併用會增強中樞神經抑制作用',
    mechanism: '加成性中樞神經抑制效果',
    clinicalEffect: '呼吸抑制、過度鎮靜、低血壓',
    management: '密切監測呼吸狀態、鎮靜深度（RASS評分）與血壓，必要時調整劑量',
    references: 'MICROMEDEX'
  },
  {
    id: 'int3',
    drugA: 'Propofol',
    drugB: 'Fentanyl',
    severity: 'medium',
    description: '併用增強鎮靜與呼吸抑制效果',
    mechanism: '協同性中樞神經抑制',
    clinicalEffect: '呼吸抑制、血壓下降、心搏過緩',
    management: '監測生命徵象，必要時調整輸注速率，準備急救設備',
    references: 'FDA Label'
  },
  {
    id: 'int4',
    drugA: 'Vancomycin',
    drugB: 'Gentamicin',
    severity: 'high',
    description: '兩者併用增加腎毒性風險',
    mechanism: '加成性腎毒性',
    clinicalEffect: '急性腎損傷、血清肌酸酐上升',
    management: '監測腎功能（BUN、Scr）、尿量，調整劑量，監測藥物血中濃度',
    references: 'UpToDate'
  },
  {
    id: 'int5',
    drugA: 'Furosemide',
    drugB: 'Gentamicin',
    severity: 'medium',
    description: 'Furosemide 可能增強 Gentamicin 的耳毒性',
    mechanism: '利尿劑增加氨基糖苷類藥物在內耳的濃度',
    clinicalEffect: '聽力損失、耳鳴、眩暈',
    management: '監測聽力功能，調整劑量，監測 Gentamicin 血中濃度',
    references: 'Micromedex'
  },
  {
    id: 'int6',
    drugA: 'Aspirin',
    drugB: 'Warfarin',
    severity: 'high',
    description: '併用顯著增加出血風險',
    mechanism: '抗血小板與抗凝血作用的加成效果',
    clinicalEffect: '胃腸道出血、顱內出血風險增加',
    management: '評估併用必要性，監測 INR 與出血徵象，考慮使用 PPI 保護胃黏膜',
    references: 'UpToDate'
  },
  {
    id: 'int7',
    drugA: 'Phenytoin',
    drugB: 'Warfarin',
    severity: 'medium',
    description: 'Phenytoin 可能增強或減弱 Warfarin 效果',
    mechanism: '複雜的藥物交互作用，涉及蛋白結合與代謝',
    clinicalEffect: 'INR 值可能上升或下降',
    management: '密切監測 INR，調整 Warfarin 劑量',
    references: 'Micromedex'
  },
  {
    id: 'int8',
    drugA: 'Metformin',
    drugB: 'Contrast Media',
    severity: 'high',
    description: '腎功能不全時併用可能導致乳酸酸中毒',
    mechanism: '顯影劑可能惡化腎功能，增加 Metformin 蓄積',
    clinicalEffect: '乳酸酸中毒（Lactic Acidosis）',
    management: '檢查前暫停 Metformin，確認腎功能正常後再重新使用',
    references: 'FDA Warning'
  },
  {
    id: 'int9',
    drugA: 'Digoxin',
    drugB: 'Amiodarone',
    severity: 'high',
    description: 'Amiodarone 增加 Digoxin 血中濃度',
    mechanism: 'Amiodarone 抑制 P-glycoprotein，減少 Digoxin 排除',
    clinicalEffect: 'Digoxin 中毒：噁心、嘔吐、心律不整',
    management: '併用時 Digoxin 劑量減半，監測血中濃度與心電圖',
    references: 'Micromedex'
  },
  {
    id: 'int10',
    drugA: 'Heparin',
    drugB: 'Aspirin',
    severity: 'medium',
    description: '增加出血風險',
    mechanism: '抗凝血與抗血小板作用協同',
    clinicalEffect: '出血風險增加',
    management: '監測凝血功能與出血徵象，評估併用必要性',
    references: 'UpToDate'
  },
  {
    id: 'int11',
    drugA: 'Ceftriaxone',
    drugB: 'Calcium',
    severity: 'high',
    description: '可能形成沉澱物導致致命併發症',
    mechanism: 'Ceftriaxone 與鈣離子形成不溶性鹽類',
    clinicalEffect: '肺部與腎臟沉澱，可能致命',
    management: '避免在 48 小時內併用，使用不同輸注管路',
    references: 'FDA Black Box Warning'
  },
  {
    id: 'int12',
    drugA: 'Propofol',
    drugB: 'Midazolam',
    severity: 'medium',
    description: '加成性鎮靜效果',
    mechanism: '協同性 GABA 受體活化',
    clinicalEffect: '過度鎮靜、呼吸抑制',
    management: '調整劑量，密切監測鎮靜深度（RASS）',
    references: 'Clinical Guidelines'
  }
];

// IV 相容性數據
export interface IVCompatibility {
  id: string;
  drugA: string;
  drugB: string;
  solution: 'NS' | 'D5W' | 'LR' | 'D5NS' | 'multiple';
  compatible: boolean;
  timeStability?: string; // 穩定時間
  notes?: string;
  concentration?: string;
  references?: string;
}

export const mockIVCompatibility: IVCompatibility[] = [
  {
    id: 'comp1',
    drugA: 'Morphine',
    drugB: 'Midazolam',
    solution: 'NS',
    compatible: true,
    timeStability: '24 hours',
    concentration: 'Standard ICU concentrations',
    references: 'Trissel\'s Handbook'
  },
  {
    id: 'comp2',
    drugA: 'Propofol',
    drugB: 'Fentanyl',
    solution: 'NS',
    compatible: false,
    notes: '需使用不同輸注管路，Propofol 會吸附 Fentanyl',
    references: 'Micromedex IV Compatibility'
  },
  {
    id: 'comp3',
    drugA: 'Furosemide',
    drugB: 'Calcium Gluconate',
    solution: 'NS',
    compatible: false,
    notes: '會產生沉澱，必須分開給藥',
    references: 'Trissel\'s'
  },
  {
    id: 'comp4',
    drugA: 'Vancomycin',
    drugB: 'Heparin',
    solution: 'NS',
    compatible: true,
    timeStability: '4 hours',
    concentration: 'Vancomycin 5 mg/mL, Heparin 1 unit/mL',
    references: 'Micromedex'
  },
  {
    id: 'comp5',
    drugA: 'Midazolam',
    drugB: 'Fentanyl',
    solution: 'NS',
    compatible: true,
    timeStability: '24 hours',
    notes: '常用於 ICU 鎮靜',
    references: 'Clinical Practice'
  },
  {
    id: 'comp6',
    drugA: 'Propofol',
    drugB: 'Midazolam',
    solution: 'NS',
    compatible: false,
    notes: 'Propofol 為乳劑，建議使用不同管路',
    references: 'Manufacturer Guidelines'
  },
  {
    id: 'comp7',
    drugA: 'Norepinephrine',
    drugB: 'Insulin',
    solution: 'NS',
    compatible: true,
    timeStability: '24 hours',
    concentration: 'Standard concentrations',
    references: 'Trissel\'s'
  },
  {
    id: 'comp8',
    drugA: 'Heparin',
    drugB: 'Insulin',
    solution: 'NS',
    compatible: true,
    timeStability: '24 hours',
    notes: '常見組合，用於 ICU',
    references: 'Clinical Guidelines'
  },
  {
    id: 'comp9',
    drugA: 'Amiodarone',
    drugB: 'Furosemide',
    solution: 'D5W',
    compatible: false,
    notes: '會產生沉澱，需分開給藥',
    references: 'Micromedex'
  },
  {
    id: 'comp10',
    drugA: 'Phenytoin',
    drugB: 'D5W',
    solution: 'D5W',
    compatible: false,
    notes: 'Phenytoin 只能溶於 NS，D5W 會產生沉澱',
    references: 'FDA Label'
  },
  {
    id: 'comp11',
    drugA: 'Ceftriaxone',
    drugB: 'Calcium Gluconate',
    solution: 'NS',
    compatible: false,
    notes: '嚴禁併用！會形成致命沉澱物',
    references: 'FDA Black Box Warning'
  },
  {
    id: 'comp12',
    drugA: 'Dopamine',
    drugB: 'Norepinephrine',
    solution: 'NS',
    compatible: true,
    timeStability: '24 hours',
    notes: '可使用同一條 central line',
    references: 'ICU Protocol'
  },
  {
    id: 'comp13',
    drugA: 'Pantoprazole',
    drugB: 'Midazolam',
    solution: 'NS',
    compatible: true,
    timeStability: '4 hours',
    references: 'Trissel\'s'
  },
  {
    id: 'comp14',
    drugA: 'Vancomycin',
    drugB: 'Piperacillin/Tazobactam',
    solution: 'NS',
    compatible: false,
    notes: '會降解，需分開輸注',
    references: 'Micromedex'
  }
];