/**
 * 陽明抗生素醫令代碼清單 (來源: 陽明抗生素清單 20260303.xlsx)
 * 用於判別 Other Medications 中哪些屬於抗生素，以優先排序顯示。
 */
export const ANTIBIOTIC_ORDER_CODES = new Set([
  'F3HP', 'FERAF', 'FISON5', 'FLAGE1', 'FPAXL1', 'FPRIF1', 'FTRUV3', 'FVEKL2',
  'FXOCO1', 'IAMIN9', 'IAMOC2', 'IAMOC2P', 'IAMPI2', 'IAMSU1', 'IBICI2', 'IBOBI1',
  'IBROS2', 'ICEFE2', 'ICEFE4', 'ICEFT7', 'ICEFU1', 'ICEPH2', 'ICETA1', 'ICETA2',
  'ICETI1', 'ICINO1', 'ICIPR1', 'ICLIN1', 'ICOLI1', 'ICOLI1N', 'ICRAV2', 'ICRES1',
  'ICUBI5', 'ICULI1', 'ICYME2', 'IDIFL1', 'IERAX1', 'IERTA1', 'IFLOM1', 'IFOLS1',
  'IGENT1', 'ILEVO4', 'ILOFA2', 'IMENO2', 'IMEPE1', 'IMERO3', 'IMETA1', 'IMETR2',
  'IOCIL1', 'IPIPE4', 'IRAPI3', 'IREKA1', 'ISEFO1', 'ISEVA1', 'ISINT1', 'ISTAZ1',
  'ISUPE1', 'ITAIG1', 'ITARG1', 'ITATU2', 'ITAZO2', 'ITEIC1', 'ITEIC2', 'ITIGE1',
  'ITYGA1', 'ITYLI1', 'IUNAS1', 'IVANC4', 'IVOCA1', 'IZAVI1', 'IZEFO2', 'IZERB1',
  'IZINF1', 'IZOVI1', 'IZYVO1', 'OACYL1', 'OAMOX7', 'OAVEL1', 'OBARA1', 'OBARA2',
  'OBIKT1', 'OCEFI1', 'OCEFI1P', 'OCEFL1', 'OCINO2', 'OCRES3', 'OCURA2', 'OCURA4',
  'ODIFL1', 'ODISF1', 'ODOVA1', 'ODOXY3', 'OEPCL1', 'OETHA1', 'OFAMV1', 'OICOM1',
  'OISON2', 'OJULU1', 'OKLAR1', 'OLEFL1', 'OLEVO2', 'OLIND1', 'OMACO1', 'OMINO1',
  'OMORC1', 'OODEF1', 'OPARA2', 'OPICO1', 'OPYRA3', 'ORIFA6', 'OTAIG1', 'OTAMI1',
  'OTRIU1', 'OTRUV1', 'OULEX2', 'OVALA1', 'OVALC1', 'OVEML1', 'OXOFL1', 'OZITH1',
  'OZITH2', 'OZYVO1',
  // Topical antibiotics (外用抗生素)
  'TBIOM1', 'TSPER2', 'ONYST1', 'TSSD1', 'TEARF1',
]);

const ABX_NAME_PATTERN = /\(抗[1-4]\)/;

/**
 * Check if a medication is an antibiotic.
 * Matching strategy (any match = antibiotic):
 * 1. orderCode exact match in the Excel list (including topical)
 * 2. category === 'antibiotic'
 * 3. Name contains (抗1)/(抗2)/(抗3)/(抗4) — Taiwan antimicrobial tier marking
 */
export function isAntibiotic(med: { orderCode?: string | null; category?: string; name?: string }): boolean {
  if (med.orderCode && ANTIBIOTIC_ORDER_CODES.has(med.orderCode)) return true;
  if (med.category === 'antibiotic') return true;
  if (med.name && ABX_NAME_PATTERN.test(med.name)) return true;
  return false;
}
