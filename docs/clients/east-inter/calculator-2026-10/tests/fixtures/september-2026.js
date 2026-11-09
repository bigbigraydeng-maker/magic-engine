// Previous (2026-09-20) quote, RMB, from the old 2026年东际澳洲报价.xls, and the AUD figures published in
// "East Inter Freight Rates.pdf" (September 2026). Used only to prove the conversion rule and to compute the old-vs-new diff.
// Frozen, self-contained snapshot of the September 2026 quote (RMB). Deliberately NOT derived from pricing-rates.js,
// so a wrong edit to the current config cannot silently change the baseline.
const old = {
 "effective": "September 2026",
 "fx": {
  "rmbPerAud": 4.9
 },
 "cities": {
  "sydney": "Sydney",
  "melbourne": "Melbourne",
  "brisbane": "Brisbane",
  "perth": "Perth (Fremantle)",
  "adelaide": "Adelaide",
  "goldCoast": "Gold Coast",
  "sunshineCoast": "Sunshine Coast",
  "other": "Other cities"
 },
 "lcl": {
  "sydney": {
   "firstRmb": 1900,
   "largeRmb": 1600,
   "nextRmb": 1100,
   "days": "Approx. 20 days"
  },
  "melbourne": {
   "firstRmb": 1900,
   "largeRmb": 1600,
   "nextRmb": 1100,
   "days": "Approx. 20 days"
  },
  "brisbane": {
   "firstRmb": 1900,
   "largeRmb": 1600,
   "nextRmb": 1100,
   "days": "Approx. 25 days"
  },
  "goldCoast": {
   "firstRmb": 1900,
   "largeRmb": 1600,
   "nextRmb": 1100,
   "days": "Approx. 25 days",
   "extra": 55,
   "minimum": 275,
   "fee": "Regional surcharge"
  },
  "sunshineCoast": {
   "firstRmb": 1900,
   "largeRmb": 1600,
   "nextRmb": 1100,
   "days": "Approx. 25 days",
   "extra": 55,
   "minimum": 275,
   "fee": "Regional surcharge"
  },
  "perth": {
   "firstRmb": 1700,
   "largeRmb": 1650,
   "nextRmb": 1200,
   "days": "25–30 days",
   "extra": 55,
   "minimum": 165,
   "fee": "Door delivery",
   "optional": true
  },
  "adelaide": {
   "firstRmb": 2150,
   "largeRmb": 2050,
   "nextRmb": 1400,
   "days": "Approx. 30 days",
   "extra": 35,
   "minimum": 135,
   "fee": "Door delivery",
   "optional": true
  }
 },
 "airParcel": {
  "normal": {
   "firstRmb": 70,
   "nextRmb": 26,
   "days": "7–12 days"
  },
  "sensitive": {
   "firstRmb": 87,
   "nextRmb": 33,
   "days": "7–14 days"
  }
 },
 "seaParcel": {
  "metro": {
   "firstRmb": 80,
   "nextRmb": 10,
   "flatRmb": 11
  },
  "other": {
   "firstRmb": 105,
   "nextRmb": 30,
   "flatRmb": 24
  }
 },
 "bulkAir": {
  "unitKg": 0.5,
  "sydney": {
   "DDURmb": [
    [
     10,
     48
    ],
    [
     51,
     47
    ]
   ],
   "DDPRmb": [
    [
     10,
     52
    ],
    [
     50,
     51
    ]
   ],
   "days": "6–8 days"
  },
  "melbourne": {
   "DDURmb": [
    [
     10,
     48
    ],
    [
     51,
     47
    ]
   ],
   "DDPRmb": [
    [
     10,
     52
    ],
    [
     50,
     51
    ]
   ],
   "days": "6–8 days"
  },
  "brisbane": {
   "DDURmb": [
    [
     10,
     50
    ],
    [
     51,
     49
    ]
   ],
   "DDPRmb": [
    [
     10,
     54
    ],
    [
     50,
     53
    ]
   ],
   "days": "8–10 days"
  },
  "adelaide": {
   "DDURmb": [
    [
     10,
     50
    ],
    [
     51,
     49
    ]
   ],
   "DDPRmb": [
    [
     10,
     54
    ],
    [
     50,
     53
    ]
   ],
   "days": "8–10 days"
  },
  "perth": {
   "DDURmb": [
    [
     10,
     52
    ],
    [
     51,
     51
    ]
   ],
   "DDPRmb": [
    [
     10,
     56
    ],
    [
     50,
     55
    ]
   ],
   "days": "8–12 days"
  },
  "other": {
   "DDURmb": [
    [
     10,
     57
    ],
    [
     51,
     56
    ]
   ],
   "DDPRmb": [
    [
     10,
     61
    ],
    [
     50,
     60
    ]
   ],
   "days": "8–12 days"
  }
 },
 "fees": {
  "fumigationRmb": 700,
  "brokerAud": 99,
  "brokerHighAud": 201,
  "brokerHighThresholdAud": 10000,
  "aqisFumigationAud": 49,
  "dduClearanceAud": 110,
  "dduClearanceThresholdAud": 1000
 }
};
const pdfAud = {
  lcl:{sydney:[388,327,225],perth:[347,337,245],adelaide:[439,419,286]}, // [first, 10+ first, next]
  airParcel:{normal:[15,6],sensitive:[18,7]},
  seaParcel:{metro:[17,3,3],other:[22,7,5]}, // [first kg, extra kg, 20kg+ flat]
  bulk:{sydney:[10,11],brisbane:[11,12],perth:[11,12],other:[12,13]}, // [DDU, DDP]
  fumigation:143
};
module.exports = {old,pdfAud};
