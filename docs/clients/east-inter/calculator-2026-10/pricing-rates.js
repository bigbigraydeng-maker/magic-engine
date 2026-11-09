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
    // Remote delivery postcodes for bulk air (空运大件 sheets, 含税 and 不含税 lists are identical): extra RMB per kg on top of the
    // route price. Source lists are in the sheet columns to the right of the price table. 4411 and 6765 are listed under both
    // RMB3 and RMB16, and 4887 twice under RMB16: the higher surcharge is used. 7151 is in the RMB16 list but also in the no-service note, so it is treated as ask-for-quote only. askQuote = sheet's 「需要单询」 postcodes plus the
    // 「无服务邮编」 note (2898-2899, 7151-7154, 6324, 4551, 3940, 3885, 0885, 2622): no price is shown, the customer is told to contact us.
    remotePostcodes: {
      surchargeRmbPerKg: {
        3: ['2361','2406','2409','3512','3562','3579','4271','4275','4285','4287','4384','4387','4388','4406','4407','4408','4410','4412','4413','4415','4416','4417','4418','4419','4420','4421','4422','4423','4424','4425','4426','4427','4428','4455','4494','4496','4497','4498','4507','4570','4650','4655','4662','4670','4737','4740','4750','4751','4753','4754','5271','5301','5302','5303','5304','5306','5307','5308','5309','5310','5311','5401','5410','5440','5606','6232','6288','6322','6323','6430','6450','6530','6743','6754','6758','6760','6762'],
        10: ['0862','2641','2643','3461','4272','4357','4385','4461','4462','4465','4467','4468','4470','4471','4472','4478','4487','4488','4489','4490','4674','4676','4677','4678','4694','4700','4702','4705','4707','4721','4722','4723','4725','4726','4727','4728','4730','4731','4732','4733','4738','4739','4741','4743','4744','4745','4746','4756','4757','4799','4800','4801','4803','4804','4805','4806','4807','4808','4809','4810','4824','5605','5607','6220','6225','6230','6236','6255','6275','6280','6281','6302','6312','6317','6330','6338','6350','6352','6356','6359','6372','6395','6398','6401','6423','6432','6442','6503','6516','6642','6701','6707','6714','6720','6721','6722','6740','6751','6753'],
        16: ['0840','0841','0845','0846','0847','0850','0870','0872','0881','0886','2627','2628','2629','2630','2631','2632','2633','2642','2644','2645','2646','2648','2649','2650','2652','2653','2655','2656','2658','2660','2663','2665','2666','2669','2671','2672','2675','2680','2681','2700','2701','2702','2705','2706','2707','2710','2711','2712','2713','2714','2715','2716','2717','2720','2721','2722','2726','2727','2729','2731','2732','2733','2734','2736','2737','2738','2739','2790','2792','2793','2794','2795','2797','2798','2800','2803','2804','2805','2806','2807','2808','2809','2810','2818','2820','2823','2825','2826','2827','2828','2829','2830','2831','2832','2833','2834','2835','2836','2839','2840','2842','2846','2850','2852','2865','2867','2868','2871','2873','2877','2878','2879','2880','2890','3697','3699','3701','3705','3707','3708','3709','3719','3723','3740','3741','3778','3844','3862','3893','3895','3896','3898','3900','4025','4183','4184','4411','4454','4474','4475','4477','4479','4480','4481','4482','4486','4491','4492','4493','4565','4581','4735','4736','4812','4816','4817','4819','4821','4822','4823','4825','4828','4829','4830','4849','4850','4852','4854','4855','4856','4857','4858','4859','4860','4861','4865','4871','4872','4873','4874','4876','4877','4879','4880','4881','4883','4884','4885','4886','4887','4888','4890','4891','4892','4895','5220','5221','5222','5223','5558','5600','5601','5690','5733','6161','6536','6705','6725','6727','6728','6731','6765','6770','6958','7001','7005','7182','7184','7186','7190','7213','7214','7215','7254','7259','7264','7270','7304','7306','7307','7310','7315','7316','7320','7321','7325','7330','7331','7466','7468','7469','7470']
      },
      askQuote: ['0822','0832','0834','0835','0836','0837','0838','0839','0852','0880','0885','2622','2849','2898','2899','3885','3888','3940','4551','4703','4875','6324','6434','6443','6712','6798','6799','7151','7152','7153','7154','7255','7256','7257']
    },
    // Fees quoted in the sea sheet notes. fumigationRmb is converted; broker fees are AUD in the source.
    fees: {fumigationRmb:700, brokerAud:99, brokerHighAud:201, brokerHighThresholdAud:10000, aqisFumigationAud:49,
      // Tax-excluded bulk air (不含税 sheet): clearance fee applies when declared goods value exceeds the threshold.
      dduClearanceAud:110, dduClearanceThresholdAud:1000}
  };
});
