/* East Inter pricing engine. Pure functions: no DOM, no rate numbers. Rates come from pricing-rates.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EastInterEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const number = n => new Intl.NumberFormat('en-AU',{maximumFractionDigits:2}).format(n);
  const money = n => 'A$' + number(n);
  const ceilUnits = (n,size) => Math.ceil(n / size - 1e-9);
  const toAud = (rmb,rmbPerAud) => Math.ceil(rmb / rmbPerAud - 1e-9);

  function resolveRates(config) {
    const fx = config.fx.rmbPerAud, aud = rmb => toAud(rmb,fx);
    const lcl = {};
    Object.entries(config.lcl).forEach(([city,r]) => {
      const {firstRmb,largeRmb,nextRmb,...rest} = r;
      lcl[city] = {first:aud(firstRmb),large:aud(largeRmb),next:aud(nextRmb),...rest};
    });
    const airParcel = {};
    Object.entries(config.airParcel).forEach(([k,r]) => {airParcel[k] = {first:aud(r.firstRmb),next:aud(r.nextRmb),days:r.days};});
    const seaParcel = {};
    Object.entries(config.seaParcel).forEach(([k,r]) => {seaParcel[k] = {first:aud(r.firstRmb),next:aud(r.nextRmb),flat:aud(r.flatRmb)};});
    const bulk = {unitKg:config.bulkAir.unitKg};
    Object.entries(config.bulkAir).forEach(([k,r]) => {if (k !== 'unitKg') bulk[k] = {DDU:aud(r.DDURmb),DDP:aud(r.DDPRmb),days:r.days};});
    const f = config.fees;
    const fees = {fumigation:aud(f.fumigationRmb),broker:f.brokerAud,brokerHigh:f.brokerHighAud,brokerHighThreshold:f.brokerHighThresholdAud};
    return {lcl,airParcel,seaParcel,bulk,fees};
  }

  function createEngine(config) {
    const R = resolveRates(config);
    const seaExtras = 'Not included: any applicable GST (10% of goods value), import duty (0–10%, depending on product), fumigation ('+money(R.fees.fumigation)+' per shipment for wood/natural materials), or customs broker fee ('+money(R.fees.broker)+'; '+money(R.fees.brokerHigh)+' if cargo value exceeds '+money(R.fees.brokerHighThreshold)+'). Contact us to confirm which charges apply.';

    function estimate({service,city,quantity,cargo='normal',tax='DDP',delivery='door',volume=null}) {
      if (!Number.isFinite(quantity) || quantity <= 0) return {error:'Enter a valid weight or volume greater than zero.'};
      if (service !== 'lcl' && volume !== null && (!Number.isFinite(volume) || volume < 0)) return {error:'Enter a valid packed volume of zero or greater, or leave it blank.'};
      const volumetric = service === 'lcl' || volume === null ? 0 : volume * 1000000 / 6000;
      const weight = service === 'lcl' ? quantity : Math.max(quantity,volumetric);
      if (!Number.isFinite(weight)) return {error:'The entered shipment size is too large. Contact us for a quote.'};
      if (service === 'lcl' && quantity < 1) return {error:'LCL rates start at 1 m³. Contact us for smaller shipments.'};
      if (service === 'bulkAir' && (weight < 10 || weight > 99)) return {error:'Standard bulk air rates cover 10–99kg chargeable weight only. Contact us for other weights, including the reduced rates for shipments over 100kg.'};
      let total=0, days='—', note='', warning='', billed=weight, lines=[];
      if (service === 'lcl') {
        const rate=R.lcl[city];
        if (!rate) return {error:'Contact us for LCL rates to this destination.'};
        const first=quantity >= 10 ? rate.large : rate.first;
        total=first+(quantity-1)*rate.next; days=rate.days;
        lines.push(['First CBM · '+(quantity >= 10 ? '10 m³ and above' : 'under 10 m³'),first]);
        if (quantity > 1) lines.push(['Additional '+number(quantity-1)+' m³ × '+money(rate.next),(quantity-1)*rate.next]);
        note='Includes China export clearance, ocean freight, Australian import clearance and AQIS inspection. ';
        if (rate.extra && (!rate.optional || delivery === 'door')) {
          const fee=Math.max(quantity*rate.extra,rate.minimum);
          total+=fee;
          lines.push([rate.fee+' · '+money(rate.extra)+'/m³ (min. '+money(rate.minimum)+')',fee]);
          note+=rate.fee+' is included in this estimate. ';
        } else if (rate.optional) {
          note+='Warehouse collection selected; door delivery is not included. ';
        } else {
          note+='Delivery within 30km of the warehouse is included; contact us for addresses outside this area. ';
        }
        note+='Origin: Guangzhou. Cargo cut-off: Tuesday; vessel departs the following Monday.';
        warning=seaExtras;
      } else if (service === 'airParcel') {
        const rate=R.airParcel[cargo],units=ceilUnits(weight,0.5);
        billed=units*0.5; total=rate.first+(units-1)*rate.next; days=rate.days;
        lines.push(['First 0.5kg',rate.first]);
        if (units > 1) lines.push(['Additional '+(units-1)+' × 0.5kg × '+money(rate.next),(units-1)*rate.next]);
        note='Billed weight: '+number(billed)+'kg · '+(cargo === 'normal' ? 'General goods.' : 'Sensitive goods (powders / liquids / batteries).');
        warning=weight >= 10 ? 'The guide lists small parcels as under approximately 10kg. This is a parcel-rate estimate only; use Bulk air freight or contact us to confirm eligibility for this weight.' : '';
      } else if (service === 'seaParcel') {
        const rate=R.seaParcel[['sydney','melbourne'].includes(city)?'metro':'other'];
        const kg=ceilUnits(weight,1); billed=kg; days='30–40 days';
        if (kg >= 20) {
          total=kg*rate.flat; lines.push([number(kg)+'kg × '+money(rate.flat)+'/kg',total]);
          note='Billed weight: '+number(kg)+'kg. The 20kg+ flat rate applies to the whole shipment; no first-kg charge is added.';
        } else {
          total=rate.first+(kg-1)*rate.next; lines.push(['First 1kg',rate.first]);
          if (kg > 1) lines.push(['Additional '+(kg-1)+'kg × '+money(rate.next),(kg-1)*rate.next]);
          note='Billed weight: '+number(kg)+'kg. Below 20kg billed weight, first-kg and additional-kg charges apply.';
        }
        warning=seaExtras;
      } else {
        const rate=R.bulk[city]||R.bulk.other,unit=R.bulk.unitKg,units=ceilUnits(weight,unit);
        billed=units*unit; total=units*rate[tax]; days=rate.days;
        lines.push([units+' × '+unit+'kg × '+money(rate[tax]),total]);
        note=tax+' · Billed weight: '+number(billed)+'kg. '+(tax === 'DDP' ? 'All taxes prepaid; no extra charges at delivery.' : 'Recipient pays Australian duties and GST on arrival; these are not included.');
      }
      if (!Number.isFinite(total)) return {error:'The entered shipment size is too large. Contact us for a quote.'};
      if (service !== 'lcl') {
        note+=' Actual weight: '+number(quantity)+'kg.';
        if (volume !== null) note+=' Volume weight: '+number(volumetric)+'kg. The greater weight is used before rounding.';
        else note+=' Packed volume not provided; estimate assumes actual weight is the chargeable weight.';
      }
      return {total,days,note,warning,lines,billed};
    }
    return {rates:R,cities:config.cities,effective:config.effective,estimate};
  }
  return {createEngine,resolveRates,toAud,number,money,ceilUnits};
});
