/* East Inter freight rate configuration.
 * Source: "2026年东际澳洲报价.xls" received 2026-10-10 (RMB). To change rates, edit only this file.
 * AUD figures shown on the page are derived: ceil(RMB / rmbPerAud) per price component, the same rule that
 * reproduces every AUD figure in the September 2026 rate guide (see tests/rule-reproduces-september.test.js).
 */
(function (root, factory) {
  const rates = factory();
  if (typeof module === 'object' && module.exports) module.exports = rates;
  else root.EastInterRates = rates;
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    // Sheet has no effective date and East Inter has not confirmed one: keep this label neutral until they do.
    effective: 'Current',
    fx: {rmbPerAud: 4.9},
    cities: {sydney:'Sydney',melbourne:'Melbourne',brisbane:'Brisbane',perth:'Perth (Fremantle)',adelaide:'Adelaide',goldCoast:'Gold Coast',sunshineCoast:'Sunshine Coast',other:'Other cities'},
    // LCL sea freight, RMB per CBM. first = 1-10 CBM first CBM, large = first CBM at 10 CBM and above, next = each additional CBM.
    // extraAud / minimumAud are already AUD in the source sheet (not converted).
    lcl: {
      sydney:{firstRmb:1850,largeRmb:1550,nextRmb:1050,days:'Approx. 20 days'},
      melbourne:{firstRmb:1850,largeRmb:1550,nextRmb:1050,days:'Approx. 20 days'},
      brisbane:{firstRmb:1850,largeRmb:1550,nextRmb:1050,days:'Approx. 25 days'},
      goldCoast:{firstRmb:1850,largeRmb:1550,nextRmb:1050,days:'Approx. 25 days',extra:55,minimum:275,fee:'Regional surcharge'},
      sunshineCoast:{firstRmb:1850,largeRmb:1550,nextRmb:1050,days:'Approx. 25 days',extra:55,minimum:275,fee:'Regional surcharge'},
      perth:{firstRmb:1650,largeRmb:1600,nextRmb:1100,days:'25–30 days',extra:55,minimum:165,fee:'Door delivery',optional:true},
      adelaide:{firstRmb:2050,largeRmb:2000,nextRmb:1300,days:'Approx. 30 days',extra:35,minimum:135,fee:'Door delivery',optional:true}
    },
    // Small air parcels, RMB per 0.5kg.
    airParcel: {
      normal:{firstRmb:70,nextRmb:26,days:'7–12 days'},
      sensitive:{firstRmb:87,nextRmb:33,days:'7–14 days'}
    },
    // Small sea parcels, RMB per kg. flatRmb applies to the whole shipment from 20kg billed weight.
    seaParcel: {
      metro:{firstRmb:80,nextRmb:10,flatRmb:11},
      other:{firstRmb:105,nextRmb:30,flatRmb:24}
    },
    // Bulk air, RMB. DDURmb / DDPRmb are [minimum chargeable kg, RMB] tiers: DDP (含税 sheet) 10KG+ and 50KG+, DDU (不含税 sheet) 10KG以上 and 51KG以上.
    // The 100KG+ and higher tiers are outside this calculator's 10–99kg range. unitKg is the weight one price applies to.
    // Confirmed by the PM on 2026-10-10 (answer relayed from East Inter): the sheet prices are per 1 kg.
    // (The September calculator treated them as per 0.5kg, which doubled the bulk-air price.)
    bulkAir: {
      unitKg: 1,
      sydney:{DDURmb:[[10,48],[51,47]],DDPRmb:[[10,52],[50,51]],days:'6–8 days'},melbourne:{DDURmb:[[10,48],[51,47]],DDPRmb:[[10,52],[50,51]],days:'6–8 days'},
      brisbane:{DDURmb:[[10,50],[51,49]],DDPRmb:[[10,54],[50,53]],days:'8–10 days'},adelaide:{DDURmb:[[10,50],[51,49]],DDPRmb:[[10,54],[50,53]],days:'8–10 days'},
      perth:{DDURmb:[[10,52],[51,51]],DDPRmb:[[10,56],[50,55]],days:'8–12 days'},other:{DDURmb:[[10,57],[51,56]],DDPRmb:[[10,61],[50,60]],days:'8–12 days'}
    },
    // Fees quoted in the sea sheet notes. fumigationRmb is converted; broker fees are AUD in the source.
    fees: {fumigationRmb:700, brokerAud:99, brokerHighAud:201, brokerHighThresholdAud:10000, aqisFumigationAud:49,
      // Tax-excluded bulk air (不含税 sheet): clearance fee applies when declared goods value exceeds the threshold.
      dduClearanceAud:110, dduClearanceThresholdAud:1000}
  };
});
