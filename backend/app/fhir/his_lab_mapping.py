"""HIS LAB_CODE -> ChatICU JSONB mapping.

Built from 13 patients' getLabResult.json (379 unique LAB_CODE+LAB_NAME+REP_TYPE_NAME combos).
Maps each HIS lab code to (chaticu_category, chaticu_key, his_lab_name).

Usage:
    from app.fhir.his_lab_mapping import HIS_LAB_MAP, resolve_lab_code

    category, key, _ = HIS_LAB_MAP["9021E"]  # -> ("biochemistry", "Na", "Na")
"""

from typing import Dict, Optional, Tuple

# --------------------------------------------------------------------------- #
# HIS LAB_CODE -> (chaticu_category, chaticu_key, his_lab_name)
#
# Categories match loinc_map.py:
#   biochemistry, hematology, blood_gas, venous_blood_gas,
#   inflammatory, coagulation, cardiac, thyroid, hormone, lipid,
#   urinalysis, stool, pleural_fluid, culture, microbiology,
#   serology, tumor_marker, tdm, allergy, glycated, other
#
# Codes suffixed with E = emergency panel, same analyte.
# Codes suffixed with V = venous blood gas.
# Codes suffixed with P = pleural fluid specimen.
# Codes suffixed with U = urine specimen.
# --------------------------------------------------------------------------- #

HIS_LAB_MAP: Dict[str, Tuple[str, str, str]] = {

    # ======================================================================= #
    #                          BIOCHEMISTRY (生化檢驗)                          #
    # ======================================================================= #
    # --- Sodium ---
    "9021":   ("biochemistry", "Na",       "Na"),
    "9021E":  ("biochemistry", "Na",       "Na"),
    # --- Potassium ---
    "9022":   ("biochemistry", "K",        "K"),
    "9022E":  ("biochemistry", "K",        "K"),
    # --- Chloride ---
    "9023E":  ("biochemistry", "Cl",       "Cl"),
    # --- BUN ---
    "9002":   ("biochemistry", "BUN",      "BUN"),
    "9002E":  ("biochemistry", "BUN",      "BUN"),
    # --- Creatinine ---
    "9015":   ("biochemistry", "Scr",      "Cr"),
    "9015E":  ("biochemistry", "Scr",      "Cr"),
    # --- eGFR ---
    "CKDEF":  ("biochemistry", "eGFR",     "eGFR(CKD-EPI)"),
    "CKDFF":  ("biochemistry", "eGFR",     "eGFR(CKD-EPI)"),
    "CKDMM":  ("biochemistry", "eGFR",     "eGFR(CKD-EPI)"),
    "EGFRF":  ("biochemistry", "eGFR",     "eGFR(female)"),
    "EGFRM":  ("biochemistry", "eGFR",     "eGFR Male"),
    "GFRF":   ("biochemistry", "eGFR",     "eGFR(female)"),
    # --- Glucose ---
    "9005":   ("biochemistry", "Glucose",  "Glu AC"),
    "E9005":  ("biochemistry", "Glucose",  "Glu AC"),
    # --- Calcium ---
    "9011":   ("biochemistry", "Ca",       "Ca"),
    "9011E":  ("biochemistry", "Ca",       "Ca"),
    # --- Free Calcium (ionized) ---
    "24007":  ("biochemistry", "freeCa",   "Free Ca++"),
    # --- Phosphorus ---
    "9012":   ("biochemistry", "Phos",     "P"),
    # --- Magnesium ---
    "9046E":  ("biochemistry", "Mg",       "Mg"),
    # --- Albumin ---
    "9038":   ("biochemistry", "Alb",      "Alb"),
    # --- Total Protein ---
    "9040":   ("biochemistry", "TotalProtein", "Total Protein"),
    # --- A/G ratio ---
    "9038Z":  ("biochemistry", "AG_ratio", "A/G"),
    # --- AST ---
    "9025":   ("biochemistry", "AST",      "AST"),
    "9025E":  ("biochemistry", "AST",      "AST"),
    # --- ALT ---
    "9026":   ("biochemistry", "ALT",      "ALT"),  # note: HIS has no non-E 9026 in data but keeping for safety
    "9026E":  ("biochemistry", "ALT",      "ALT"),
    # --- Total Bilirubin ---
    "9029E":  ("biochemistry", "TBil",     "T. Bili"),
    # --- Direct Bilirubin ---
    "9030E":  ("biochemistry", "DBil",     "Direct Bilirubin"),
    # --- Alkaline Phosphatase ---
    "9027":   ("biochemistry", "AlkP",     "Alkaline Phosphatase"),
    # --- r-GT (GGT) ---
    "9031":   ("biochemistry", "rGT",      "r-GT"),
    # --- LDH ---
    "9033E":  ("biochemistry", "LDH",      "LDH"),
    # --- Amylase ---
    "9017E":  ("biochemistry", "Amylase",  "Amylase"),
    # --- Lipase ---
    "9064E":  ("biochemistry", "Lipase",   "Lipase"),
    # --- Ammonia ---
    "9037E":  ("biochemistry", "Ammonia",  "ammonia"),
    # --- Uric Acid ---
    "9013":   ("biochemistry", "Uric",     "Uric Acid"),
    # --- Lactate (serum, from biochemistry panel) ---
    "9059E":  ("blood_gas", "Lactate",     "Lactate"),
    # --- Ketone ---
    "9137":   ("biochemistry", "Ketone",   "Ketone"),
    # --- BUN/Cr ratio ---
    "9002Z":  ("biochemistry", "BUN_Cr_ratio", "B/C"),
    # --- Iron studies ---
    "9B19":   ("biochemistry", "Iron",     "Iron"),
    "9B15":   ("biochemistry", "TIBC",     "TIBC"),
    "12116":  ("biochemistry", "Ferritin", "Ferritin"),
    # --- Lipoprotein(a) ---
    "12164":  ("lipid", "Lpa",             "Lipoprotein a"),

    # --- Lipid panel ---
    "9001":   ("lipid", "TCHO",            "Cholesterol"),
    "9004":   ("lipid", "TG",              "Triglyceride"),
    "9043":   ("lipid", "HDLC",            "HDL-C"),
    "9044":   ("lipid", "LDLC",            "LDL-C"),

    # --- Specimen quality flags (informational, not clinical values) ---
    "9347":   ("other", "_Lipemia",        "Lipemia"),
    "9347E":  ("other", "_Lipemia",        "Lipemia"),
    "9348":   ("other", "_Icterus",        "Icterus"),
    "9348E":  ("other", "_Icterus",        "Icterus"),
    "9349":   ("other", "_Hemolysis",      "Hemolysis"),
    "9349E":  ("other", "_Hemolysis",      "Hemolysis"),

    # --- PHS notification (not a lab value) ---
    "PANB6":  ("other", "_PHS_notify",     "PHS notification"),

    # ======================================================================= #
    #                          HEMATOLOGY (血液檢驗)                             #
    # ======================================================================= #
    "802":    ("hematology", "WBC",        "WBC"),
    "801":    ("hematology", "RBC",        "RBC"),
    "803":    ("hematology", "Hb",         "Hb"),
    "804":    ("hematology", "Hct",        "Hct"),
    "808":    ("hematology", "PLT",        "PLT"),
    "805":    ("hematology", "MCV",        "MCV"),
    "806":    ("hematology", "MCH",        "MCH"),
    "807":    ("hematology", "MCHC",       "MCHC"),
    "809":    ("hematology", "RDW_CV",     "RDW-CV"),
    "811":    ("hematology", "RDW_SD",     "RDW-SD"),
    # --- Differential ---
    "832":    ("hematology", "Segment",    "Neut"),
    "833":    ("hematology", "Eos",        "Eos"),
    "834":    ("hematology", "Baso",       "Basophil"),
    "835":    ("hematology", "Mono",       "Mono"),
    "836":    ("hematology", "Lymph",      "Lym"),
    "BAND":   ("hematology", "Band",       "Band neutrophil"),
    "AL":     ("hematology", "AtyLymph",   "Atypical Lymphocyte"),
    "ATYLY":  ("hematology", "AtyLymph",   "Atypical lymphocyte"),
    "META":   ("hematology", "Meta",       "Metamyelocyte"),
    "MYELO":  ("hematology", "Myelo",      "Myelocyte"),
    "PROMY":  ("hematology", "Promyelo",   "Promyelocyte"),
    "NRBC":   ("hematology", "NRBC",       "NRBC#"),
    "8010":   ("hematology", "EoCount",    "Eosinophil count"),
    # --- ESR ---
    "8005A":  ("hematology", "ESR",        "ESR"),
    # --- Blood type ---
    "ABO":    ("hematology", "BloodType",  "Blood type"),
    "ABORH":  ("hematology", "RhType",     "Rh type"),

    # ======================================================================= #
    #                      BLOOD GAS - ARTERIAL (血液氣體)                       #
    # ======================================================================= #
    "PH":     ("blood_gas", "pH",          "PH"),
    "PCO2":   ("blood_gas", "PCO2",        "PCO2"),
    "PO2":    ("blood_gas", "PO2",         "PO2"),
    "HCO3":   ("blood_gas", "HCO3",       "HCO3"),
    "BEB":    ("blood_gas", "BE",          "BEb"),
    "BEECF":  ("blood_gas", "BEecf",       "BEecf"),
    "SO2":    ("blood_gas", "SaO2",        "Saturate O2"),

    # ======================================================================= #
    #                      BLOOD GAS - VENOUS (靜脈血氣)                         #
    # ======================================================================= #
    "PHV":    ("venous_blood_gas", "pH",    "PH(Vein)"),
    "PCO2V":  ("venous_blood_gas", "PCO2",  "PCO2(Vein)"),
    "PO2V":   ("venous_blood_gas", "PO2",   "PO2(Vein)"),
    "HCO3V":  ("venous_blood_gas", "HCO3",  "HCO3(Vein)"),
    "BEBV":   ("venous_blood_gas", "BE",    "BEb(Vein)"),
    "BEECV":  ("venous_blood_gas", "BEecf", "Be(ecf)(Vein)"),
    "SO2V":   ("venous_blood_gas", "SO2C",  "SO2C(Vein)"),

    # ======================================================================= #
    #                        INFLAMMATORY (發炎指標)                             #
    # ======================================================================= #
    "CRP":    ("inflammatory", "CRP",      "CRP"),
    "12192":  ("inflammatory", "PCT",      "Procalcitonin"),

    # ======================================================================= #
    #                        COAGULATION (血液凝固檢驗)                           #
    # ======================================================================= #
    "PT":     ("coagulation", "PT",        "PT"),
    "INR":    ("coagulation", "INR",       "INR"),
    "APTT":   ("coagulation", "aPTT",      "APTT"),
    "8079":   ("coagulation", "DDimer",    "D dimer"),
    "8023":   ("coagulation", "Fibrinogen", "Fibrinogen(quantitative)"),

    # ======================================================================= #
    #                           CARDIAC (心臟指標)                               #
    # ======================================================================= #
    "9098":   ("cardiac", "TnT",           "hs TroponinT"),
    "CKMB":   ("cardiac", "CKMB",          "CKMB"),
    "9032E":  ("cardiac", "CK",            "CPK"),
    "9032X":  ("cardiac", "CK",            "CPK"),
    "12193":  ("cardiac", "NTproBNP",      "NT-proBNP"),

    # ======================================================================= #
    #                           THYROID (甲狀腺)                                 #
    # ======================================================================= #
    "9112":   ("thyroid", "TSH",           "TSH"),
    "9106":   ("thyroid", "freeT4",        "Free T4"),
    "9117":   ("thyroid", "T3",            "T3"),

    # ======================================================================= #
    #                           HORMONE (荷爾蒙/內分泌)                           #
    # ======================================================================= #
    "9113":   ("hormone", "Cortisol",      "Cortisol 8 AM"),
    "9119":   ("hormone", "ACTH",          "ACTH 8AM"),
    "9122":   ("hormone", "iPTH",          "Intact-PTH"),
    "9552":   ("hormone", "VitD25OH",      "25-OH Vitamin D"),
    "9103":   ("hormone", "Insulin",       "Insulin (AC)"),
    "9128":   ("hormone", "CPeptide",      "C-Peptide(AC)"),
    "27068":  ("hormone", "Calcitonin",    "Calcitonin"),

    # ======================================================================= #
    #                        GLYCATED HB (醣化血色素)                             #
    # ======================================================================= #
    "9006":   ("glycated", "HbA1C",        "HbA1C"),

    # ======================================================================= #
    #                        URINALYSIS (Random尿液檢驗)                          #
    # ======================================================================= #
    "600":    ("urinalysis", "Appearance",        "Appearance"),
    "601":    ("urinalysis", "pH",                "pH"),
    "602":    ("urinalysis", "SpecGravity",       "Specific gravity"),
    "603":    ("urinalysis", "Protein",           "Protein"),
    "604":    ("urinalysis", "Glucose",           "Glucose"),
    "605":    ("urinalysis", "OB",                "OB"),
    "606":    ("urinalysis", "Bilirubin",         "Bilirubin"),
    "607":    ("urinalysis", "Ketone",            "Ketone"),
    "608":    ("urinalysis", "Urobilinogen",      "Urobilinoge"),
    "609":    ("urinalysis", "Nitrite",           "Nitrite"),
    "60C":    ("urinalysis", "Clarity",           "Clarity"),
    "610":    ("urinalysis", "LeukocyteEst",      "Leukocyte esterase"),
    "611":    ("urinalysis", "RBC",               "RBC"),
    "612":    ("urinalysis", "WBC",               "WBC"),
    "613":    ("urinalysis", "EpithCell",         "Epith cell"),
    "614":    ("urinalysis", "Cast",              "Cast"),
    "615":    ("urinalysis", "Crystal",           "Crystal"),
    "616":    ("urinalysis", "Bacteria",          "Bacteria"),
    "FUNGU":  ("urinalysis", "Fungus",            "Fungus"),
    "YEAST":  ("urinalysis", "Yeast",             "Yeast-like"),
    "GRANU":  ("urinalysis", "GranularCast",      "Granular Cast"),
    "RTE":    ("urinalysis", "RTE",               "RTE"),
    "9016":   ("urinalysis", "UCr",               "Creatinine(random urine)"),
    "12111":  ("urinalysis", "Microalbumin",      "Microalbumin(random urine)"),
    "ACR":    ("urinalysis", "ACR",               "ACR(Urine)"),
    "9021U":  ("urinalysis", "UNa",               "Na(Urine)"),
    "921UE":  ("urinalysis", "UNa",               "Na(Urine)"),
    "9040U":  ("urinalysis", "UProtein",          "Protein(URINE)"),
    "9003":   ("urinalysis", "UUN",               "Urea-N(random urine)"),
    "6503":   ("urinalysis", "UOsm",              "Osmolality(urine)"),

    # ======================================================================= #
    #                        STOOL (糞便檢驗)                                    #
    # ======================================================================= #
    "7001":   ("stool", "OccultBlood",     "Occult Blood"),
    "7001N":  ("stool", "OB_NG",           "OB (NG)"),
    "7B1":    ("stool", "Color",           "Color"),
    "7B2":    ("stool", "Form",            "Form"),
    "7B3":    ("stool", "Digestion",       "Digestion"),
    "7B4":    ("stool", "Mucus",           "Mucus"),
    "7B5":    ("stool", "WBC_PUS",         "WBC & PUS Cell"),
    "7B6":    ("stool", "OB_Chemical",     "Occult Blood(chemical)"),
    "7B7":    ("stool", "Parasite",        "Parasite & ova"),
    "7B8":    ("stool", "RedCells",        "Red cells"),

    # ======================================================================= #
    #                  PLEURAL FLUID (Pleural胸水)                              #
    # ======================================================================= #
    "16B01":  ("pleural_fluid", "Appearance",  "Apperance"),
    "16B02":  ("pleural_fluid", "Color",       "Color"),
    "16B03":  ("pleural_fluid", "Bloody",      "Bloody"),
    "16B07":  ("pleural_fluid", "Coagulation", "Coagulation"),
    "16B14":  ("pleural_fluid", "SpecGravity", "Specific gravity"),
    "16B15":  ("pleural_fluid", "Rivalta",     "Rivalta Test"),
    "16B16":  ("pleural_fluid", "RBC",         "RBC"),
    "16B17":  ("pleural_fluid", "WBC",         "WBC"),
    "16B18":  ("pleural_fluid", "PMN",         "Polymorphonuclear cell"),
    "16B19":  ("pleural_fluid", "Mono",        "Mononuclear cell"),
    "16B28":  ("pleural_fluid", "Chylous",     "Chylous"),
    "2021P":  ("pleural_fluid", "CEA",         "CEA-Pleural"),
    "9001P":  ("pleural_fluid", "Cholesterol", "Cholesterol (PF)"),
    "9004P":  ("pleural_fluid", "TG",          "TG (PF)"),
    "9005P":  ("pleural_fluid", "Glucose",     "Glu (PF)"),
    "9017P":  ("pleural_fluid", "Amylase",     "Amylase (PF)"),
    "9033P":  ("pleural_fluid", "LDH",         "LDH (PF)"),
    "9038P":  ("pleural_fluid", "Alb",         "Alb (PF)"),
    "9040P":  ("pleural_fluid", "Protein",     "Protein (PF)"),
    "9102P":  ("pleural_fluid", "ADA",         "Adenosine deaminase(Pleural fl"),

    # ======================================================================= #
    #              SEROLOGY & IMMUNOLOGY (抗體免疫血清檢驗)                         #
    # ======================================================================= #
    "12004":  ("serology", "ASLO",          "ASLO"),
    "12011":  ("serology", "RA",            "RA"),
    "12025":  ("serology", "IgG",           "IgG"),
    "12027":  ("serology", "IgA",           "IgA"),
    "12029":  ("serology", "IgM",           "IgM"),
    "12034":  ("serology", "C3",            "C3"),
    "12038":  ("serology", "C4",            "C4"),
    "1205B":  ("serology", "ANA_Pattern",   "Pattern"),
    "12062":  ("serology", "Cryoglobulin",  "Cryoglobulin"),
    "12063":  ("serology", "AntiENA",       "Anti-ENA Screening"),
    "1206C":  ("serology", "AntiSSA",       "Anti-SSA(Anti-Ro)"),
    "1206D":  ("serology", "AntiSSB",       "Anti-SSB(Anti-La)"),
    "12138":  ("serology", "AntiGBM",       "Anti-GBM antibody"),
    "12154":  ("serology", "AntiJO1",       "Anti-JO-1 antibody"),
    "12174":  ("serology", "AntiScl70",     "Anti-Scl-70 Ab"),
    "1217A":  ("serology", "AntiSM",        "Anti-SM"),
    "1217B":  ("serology", "AntiRNP",       "Anti-RNP"),
    "1217E":  ("serology", "pANCA",         "p-ANCA"),
    "1217F":  ("serology", "cANCA",         "c-ANCA"),
    "121KF":  ("serology", "KappaFLC",      "kappa free light chain"),
    "121LF":  ("serology", "LambdaFLC",     "lambda free light chain"),
    "FKLRA":  ("serology", "KL_Ratio",      "free kappa/lambda ratio"),
    # --- IGRA (TB) ---
    "404A":   ("serology", "IGRA_Nil",      "Nil"),
    "404C":   ("serology", "IGRA_Mitogen",  "Mitogen"),
    "404D":   ("serology", "IGRA_Result",   "IGRA"),
    "404E":   ("serology", "IGRA_TB1",      "TB1 antigen"),
    "404F":   ("serology", "IGRA_TB2",      "TB2 antigen"),

    # ======================================================================= #
    #         VIRAL / BACTERIAL SEROLOGY (病毒細菌抗原抗體檢驗)                      #
    # ======================================================================= #
    "14032":  ("serology", "HBsAg",         "HBsAg"),
    "14033":  ("serology", "AntiHBs",       "Anti-HBs"),
    "14051":  ("serology", "AntiHCV",       "Anti-HCV"),
    "12020":  ("serology", "Myco_IgG",      "Mycoplasma_IgG"),
    "12069":  ("serology", "CryptoAg",      "Cryptococcus Ag"),
    "12118":  ("serology", "LegionellaAb",  "Legionella Ab"),
    "12189":  ("serology", "ChlamydiaIgM",  "Chlamydia Pneumoniae IgM"),
    "12ASP":  ("serology", "AspergillusAg", "Aspergillus Ag"),
    "1305A":  ("serology", "CDiff_ToxinA",  "Toxin A"),
    "1305B":  ("serology", "CDiff_ToxinB",  "Toxin B"),
    "14007":  ("serology", "MeaslesIgM",    "Measles virus IgM"),

    # ======================================================================= #
    #                   HIV / SYPHILIS (愛滋梅毒檢驗)                             #
    # ======================================================================= #
    "1408A":  ("serology", "HIV12Ab",       "HIV-1/2 Antibody"),
    "1408B":  ("serology", "HIV1p24Ag",     "HIV-1 p24 Antigen"),
    "H1AB":   ("serology", "HIV1AbIDX",     "HIV-1 Ab IDX"),
    "H1AG":   ("serology", "HIV1AgIDX",     "HIV-1 Ag IDX"),
    "H2AB":   ("serology", "HIV2AbIDX",     "HIV-2 Ab IDX"),
    "HABAG":  ("serology", "HIVAbAgIDX",    "HIV Ab-Ag IDX"),
    "HQ1AB":  ("serology", "HIV1Ab",        "HIV-1 Ab"),
    "HQ1AG":  ("serology", "HIV1Ag",        "HIV-1 Ag"),
    "HQ2AB":  ("serology", "HIV2Ab",        "HIV-2 Ab"),
    "HQABG":  ("serology", "HIVAbAg",       "HIV Ab-Ag"),
    "RPRL":   ("serology", "RPR",           "RPR(L)"),
    "TPLA":   ("serology", "TPLA",          "TPLA"),

    # ======================================================================= #
    #                RAPID ANTIGEN (抗原快速檢驗)                                 #
    # ======================================================================= #
    "14058":  ("rapid_antigen", "RSV",       "RSV Screening test"),
    "1406A":  ("rapid_antigen", "FluA",      "Flu A"),
    "1406B":  ("rapid_antigen", "FluB",      "Flu B"),
    "14084":  ("rapid_antigen", "COVID19Ag", "COVID-19 Ag"),

    # ======================================================================= #
    #              MOLECULAR / PCR (分生病毒檢驗 — Pneumonia Panel)               #
    # ======================================================================= #
    "PN001":  ("molecular", "Acinetobacter",      "A. baumannii complex"),
    "PN002":  ("molecular", "Enterobacter",       "E. cloacae complex"),
    "PN003":  ("molecular", "EColi",              "Escherichia coli"),
    "PN004":  ("molecular", "HIinfluenzae",       "Haemophilus influenzae"),
    "PN005":  ("molecular", "KAerogenes",         "Klebsiella aerogenes"),
    "PN006":  ("molecular", "KOxytoca",           "Klebsiella oxytoca"),
    "PN007":  ("molecular", "KPneumoniae",        "K. pneumoniae group"),
    "PN008":  ("molecular", "Moraxella",           "Moraxella catarrhalis"),
    "PN009":  ("molecular", "Proteus",             "Proteus spp."),
    "PN010":  ("molecular", "Pseudomonas",         "Pseudomonas aeruginosa"),
    "PN011":  ("molecular", "Serratia",            "Serratia marcescens"),
    "PN012":  ("molecular", "SAureus",             "Staphylococcus aureus"),
    "PN013":  ("molecular", "SAgalactiae",         "Streptococcus agalactiae"),
    "PN014":  ("molecular", "SPneumoniae",         "Streptococcus pneumoniae"),
    "PN015":  ("molecular", "SPyogenes",           "Streptococcus pyogenes"),
    "PN016":  ("molecular", "ChlamydiaPn",         "Chlamydia pneumoniae"),
    "PN017":  ("molecular", "Legionella",          "Legionella pneumophila"),
    "PN018":  ("molecular", "Mycoplasma",          "Mycoplasma pneumoniae"),
    "PN019":  ("molecular", "Adenovirus",          "Adenovirus"),
    "PN020":  ("molecular", "Coronavirus",         "Coronavirus"),
    "PN021":  ("molecular", "hMPV",                "Human Metapneumovirus"),
    "PN022":  ("molecular", "RhinoEntero",         "Human Rhino/Enterovirus"),
    "PN023":  ("molecular", "FluA_PCR",            "Influenza A"),
    "PN024":  ("molecular", "FluB_PCR",            "Influenza B"),
    "PN025":  ("molecular", "Parainfluenza",       "Parainfluenza Virus"),
    "PN026":  ("molecular", "RSV_PCR",             "RSV"),
    # --- Resistance genes ---
    "PN027":  ("molecular", "CTX_M",        "CTX-M"),
    "PN028":  ("molecular", "IMP_gene",     "IMP"),
    "PN029":  ("molecular", "KPC",          "KPC"),
    "PN030":  ("molecular", "mecA_MREJ",    "mecA/C and MREJ"),
    "PN031":  ("molecular", "NDM",          "NDM"),
    "PN032":  ("molecular", "OXA48",        "OXA-48-like"),
    "PN033":  ("molecular", "VIM",          "VIM"),
    "PNCM":   ("molecular", "_Comment",     "Comment"),

    # ======================================================================= #
    #                  TUMOR MARKERS (腫瘤標誌)                                  #
    # ======================================================================= #
    "12007":  ("tumor_marker", "AFP",       "AFP"),
    "12021":  ("tumor_marker", "CEA",       "CEA"),
    "12077":  ("tumor_marker", "CA125",     "CA 125"),
    "12078":  ("tumor_marker", "CA153",     "CA 153"),
    "12079":  ("tumor_marker", "CA199",     "CA 199"),

    # ======================================================================= #
    #              THERAPEUTIC DRUG MONITORING (藥毒物檢驗)                        #
    # ======================================================================= #
    "10510":  ("tdm", "ValproicAcid",       "Valproic acid"),
    "10512":  ("tdm", "AmikacinTrough",     "Amikacin(Trough)"),

    # ======================================================================= #
    #                      ALLERGY (過敏檢驗)                                    #
    # ======================================================================= #
    "12031":  ("allergy", "IgE",            "IgE"),
    "30023":  ("allergy", "ECP",            "ECP"),
    "30021":  ("allergy", "Phadiatop",      "Phadiatop Infant"),

    # ======================================================================= #
    #              CULTURE & MICROBIOLOGY (細菌培養 + 細菌染色)                     #
    #   These are NOT numeric lab values — they are culture result metadata.   #
    #   Stored separately; included here for completeness.                    #
    # ======================================================================= #
    # Culture metadata
    "3SAM1":  ("culture", "_SampleType",    "SampleType"),
    "3SAM2":  ("culture", "_SampleType",    "SampleType"),
    "3SAM7":  ("culture", "_SampleType",    "SampleType"),
    "XEOD":   ("culture", "_RequestStatus", "Request Status"),
    "XORG1":  ("culture", "_Isolate1",      "Isolate 01"),
    "XORG2":  ("culture", "_Isolate2",      "Isolate 02"),
    "XORG3":  ("culture", "_Isolate3",      "Isolate"),
    "3COL1":  ("culture", "_Colonies1",     "Colonies 1"),
    "3COL2":  ("culture", "_Colonies2",     "Colonies 2"),
    "3COL3":  ("culture", "_Colonies3",     "Colonies 3"),
    "3RESU":  ("culture", "_Result",        "Result"),
    "3REBL":  ("culture", "_PrelimReport",  "Preliminary report"),
    "3RETL":  ("culture", "_LiquidCulture", "Liquid culture"),
    "3RETO":  ("culture", "_SolidCulture",  "Solid culture"),
    "3BAR0":  ("culture", "_QScore",        "Q Score"),
    "3BIL1":  ("culture", "_Billing",       "Billing 1"),
    "3COM2":  ("culture", "_Comment",       "Comment"),
    "3COM5":  ("culture", "_Progress",      "Report progress"),
    "COMM":   ("culture", "_Comment2",      "Comment"),
    "SAMCO":  ("culture", "_Comment3",      "Comment"),
    "BLO01":  ("culture", "_AerobicResult", "Aerobic culture"),
    "BLO02":  ("culture", "_AnaerobicResult", "Anaerobic culture"),
    "PANM3":  ("culture", "_PHS_notify",    "PHS notification"),
    "PANM4":  ("culture", "_CriticalAlert", "Critical alert"),

    # --- Antibiotic susceptibility (sensitivity results, not numeric labs) ---
    "AM":     ("susceptibility", "Ampicillin",      "Ampicillin"),
    "AM2":    ("susceptibility", "Ampicillin_MIC",   "Ampicillin MIC"),
    "AMC":    ("susceptibility", "AmoxiClav",        "Amoxicillin/Clavulanate"),
    "AN":     ("susceptibility", "Amikacin",         "Amikacin"),
    "AN2":    ("susceptibility", "Amikacin_MIC",     "Amikacin MIC"),
    "CAZ":    ("susceptibility", "Ceftazidime",      "Ceftazidime"),
    "CAZ2":   ("susceptibility", "Ceftazidime_MIC",  "Ceftazidime MIC"),
    "CC":     ("susceptibility", "Clindamycin",      "Clindamycin"),
    "CC2":    ("susceptibility", "Clindamycin_MIC",  "Clindamycin MIC"),
    "CIP":    ("susceptibility", "Ciprofloxacin",    "Ciprofloxacin"),
    "CIP2":   ("susceptibility", "Ciprofloxacin_MIC", "Ciprofloxacin MIC"),
    "CL2":    ("susceptibility", "Colistin_MIC",     "Colistin MIC"),
    "CTX":    ("susceptibility", "Cefotaxime",       "Cefotaxime"),
    "CTX2":   ("susceptibility", "Cefotaxime_MIC",   "Cefotaxime MIC"),
    "CXM":    ("susceptibility", "Cefuroxime",       "Cefuroxime"),
    "CXM2":   ("susceptibility", "Cefuroxime_MIC",   "Cefuroxime MIC"),
    "CZ":     ("susceptibility", "Cefazolin",        "Cefazolin"),
    "CZ2":    ("susceptibility", "Cefazolin_MIC",    "Cefazolin MIC"),
    "CZA":    ("susceptibility", "CeftazAvibactam",  "Ceftazidime/Avibactam"),
    "CZA2":   ("susceptibility", "CeftazAvibactam_MIC", "Ceftazidime/Avibactam MIC"),
    "DAP":    ("susceptibility", "Daptomycin",       "Daptomycin"),
    "DAP2":   ("susceptibility", "Daptomycin_MIC",   "Daptomycin MIC"),
    "FEP":    ("susceptibility", "Cefepime",         "Cefepime"),
    "FEP2":   ("susceptibility", "Cefepime_MIC",     "Cefepime MIC"),
    "FLO":    ("susceptibility", "Flomoxef",         "Flomoxef"),
    "FM":     ("susceptibility", "Nitrofurantoin",   "Nitrofurantoin"),
    "FM2":    ("susceptibility", "Nitrofurantoin_MIC", "Nitrofurantoin MIC"),
    "FOX":    ("susceptibility", "Cefoxitin",        "Cefoxitin"),
    "FOX2":   ("susceptibility", "Cefoxitin_MIC",    "Cefoxitin MIC"),
    "GM":     ("susceptibility", "Gentamicin",       "Gentamicin"),
    "GM2":    ("susceptibility", "Gentamicin_MIC",   "Gentamicin MIC"),
    "GMS":    ("susceptibility", "GentSynergy",      "Gentamicin-Synergy"),
    "GMS2":   ("susceptibility", "GentSynergy_MIC",  "Gentamicin-Synergy MIC"),
    "IPM":    ("susceptibility", "Imipenem",         "Imipenem"),
    "IPM2":   ("susceptibility", "Imipenem_MIC",     "Imipenem MIC"),
    "LVX":    ("susceptibility", "Levofloxacin",     "Levofloxacin"),
    "LVX2":   ("susceptibility", "Levofloxacin_MIC", "Levofloxacin MIC"),
    "LZD":    ("susceptibility", "Linezolid",        "Linezolid"),
    "LZD2":   ("susceptibility", "Linezolid_MIC",    "Linezolid MIC"),
    "MEM":    ("susceptibility", "Meropenem",        "Meropenem"),
    "MEM2":   ("susceptibility", "Meropenem_MIC",    "Meropenem MIC"),
    "MET":    ("susceptibility", "Metronidazole",    "Metronidazole"),
    "MET2":   ("susceptibility", "Metronidazole_MIC", "Metronidazole MIC"),
    "MI":     ("susceptibility", "Minocycline",      "Minocyclin"),
    "MI2":    ("susceptibility", "Minocycline_MIC",  "Minocyclin MIC"),
    "MXF":    ("susceptibility", "Moxifloxacin",     "Moxifloxacin"),
    "OX":     ("susceptibility", "Oxacillin",        "Oxicillin"),
    "P":      ("susceptibility", "PenicillinG",      "Penicillin G"),
    "P2":     ("susceptibility", "PenicillinG_MIC",  "Penicillin G MIC"),
    "SAM":    ("susceptibility", "AmpSulbactam",     "Ampicillin/Sulbactam"),
    "SAM2":   ("susceptibility", "AmpSulbactam_MIC", "Ampicillin/Sulbactam MIC"),
    "SXT":    ("susceptibility", "TMPSMX",           "Trimethoprim/Sulfamethoxazole"),
    "SXT2":   ("susceptibility", "TMPSMX_MIC",       "TMP/SMX MIC"),
    "TE":     ("susceptibility", "Tetracycline",     "Tetracycline"),
    "TE2":    ("susceptibility", "Tetracycline_MIC", "Tetracycline MIC"),
    "TEC":    ("susceptibility", "Teicoplanin",      "Teicoplanin"),
    "TEC2":   ("susceptibility", "Teicoplanin_MIC",  "Teicoplanin MIC"),
    "TGC":    ("susceptibility", "Tigecycline",      "Tigecycline"),
    "TGC2":   ("susceptibility", "Tigecycline_MIC",  "Tigecycline MIC"),
    "TZP":    ("susceptibility", "PipTazo",          "Piperacillin/Tazobactam"),
    "TZP2":   ("susceptibility", "PipTazo_MIC",      "Piperacillin/Tazobactam MIC"),
    "VA":     ("susceptibility", "Vancomycin",       "Vancomycin"),
    "VA2":    ("susceptibility", "Vancomycin_MIC",   "Vancomycin MIC"),

    # --- Gram stain (細菌染色) ---
    "13006":  ("gram_stain", "AFB",          "Acid fast stain"),
    "130PF":  ("gram_stain", "AFB_PF",       "AFB pleural fluid"),
    "13A02":  ("gram_stain", "GPBacillus",   "G(+) bacillus"),
    "13A03":  ("gram_stain", "GNBacillus",   "G(-) bacillus"),
    "13A04":  ("gram_stain", "GPCoccus",     "G(+) Coccus"),
    "13A09":  ("gram_stain", "YeastLike",    "Yeast Like"),
    "13A10":  ("gram_stain", "Other",        "Other"),
    "3SAM4":  ("gram_stain", "_SampleType",  "SampleType"),
}

# =========================================================================== #
#  Reverse lookup: ChatICU key -> list of HIS LAB_CODEs                       #
# =========================================================================== #
CHATICU_TO_HIS: Dict[str, list] = {}
for his_code, (cat, key, _) in HIS_LAB_MAP.items():
    full_key = f"{cat}.{key}"
    CHATICU_TO_HIS.setdefault(full_key, []).append(his_code)

# =========================================================================== #
#  ICU-critical codes: the subset most important for clinical decision-making #
# =========================================================================== #
ICU_CRITICAL_CODES = {
    # Biochemistry essentials
    "9021E", "9022E", "9015E", "9002E", "E9005", "9011E", "9046E",
    "9025E", "9026E", "9029E", "9038", "9059E",
    # Blood gas
    "PH", "PCO2", "PO2", "HCO3", "BEB", "SO2",
    "PHV", "PCO2V", "PO2V", "HCO3V", "BEBV", "SO2V",
    # Hematology
    "802", "803", "804", "808", "832", "BAND",
    # Coagulation
    "PT", "INR", "APTT", "8079",
    # Cardiac
    "9098", "12193",
    # Inflammatory
    "CRP", "12192",
    # Renal
    "CKDMM", "CKDFF", "24007",
}


def resolve_lab_code(lab_code: str) -> Optional[Tuple[str, str, str]]:
    """Look up a HIS LAB_CODE and return (category, chaticu_key, his_lab_name).

    Returns None if the code is not mapped.
    """
    return HIS_LAB_MAP.get(lab_code)


def is_numeric_lab(lab_code: str) -> bool:
    """Return True if this LAB_CODE represents a numeric lab value
    (as opposed to culture metadata, susceptibility, or gram stain).
    """
    entry = HIS_LAB_MAP.get(lab_code)
    if entry is None:
        return False
    category = entry[0]
    return category not in (
        "culture", "susceptibility", "gram_stain",
        "molecular", "rapid_antigen", "other",
    )
