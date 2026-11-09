// Starting values for settings and new quotes. Everything here can be changed
// in the app's Settings page.

function defaultSettings() {
  return {
    company: {
      name: 'Mesh Smart Home Technology',
      tagline: 'Smart homes & audio visual',
      address: '',
      phone: '',
      email: '',
      website: 'www.meshsystems.co.uk',
      companyNumber: '',
      vatNumber: '',
    },
    // The people who prepare quotes. Shown in the "Prepared by" list.
    team: [],
    // Hourly rates are in pence, excluding VAT. "cost" is what an hour costs
    // us (internal, for the profit figure); empty until you set it.
    labourTypes: [
      { id: 'installation', name: 'Installation', rate: 4500, cost: null },
      { id: 'commissioning', name: 'Commissioning', rate: 5500, cost: null },
      { id: 'programming', name: 'Programming', rate: 6500, cost: null },
      { id: 'project_management', name: 'Project management', rate: 6000, cost: null },
    ],
    vatRate: 20,
    markup: 0,
    // Our trade discount off Ubiquiti store prices (%), for the profit figure.
    costDiscount: 0,
    // Our trade discount off Sonos UK prices (%). Empty: Sonos cost unknown.
    sonosCostDiscount: null,
    includeSurcharges: true,
    validDays: 30,
    quotePrefix: 'MESH-',
    nextQuoteNumber: 1,
    display: {
      showImages: true,
      showItemPrices: true,
      showSku: true,
      showLabourDetail: false,
      // 'area': each area lists its labour at the bottom; 'end': one labour
      // section after all the areas.
      labourPlacement: 'area',
      // 'detailed' lists every item; 'summary' shows each area's total only.
      layout: 'detailed',
      // A cover on its own page. Off: the cover details sit at the top of page 1.
      coverPage: false,
    },
    defaultIntro:
      'Thank you for the opportunity to put this proposal together. It sets out the equipment we recommend and the work we will carry out, so you can see exactly what is included and what it will cost.',
    defaultScope: [
      { heading: 'Project overview', body: '' },
      { heading: 'What we will do', body: '' },
      { heading: 'What is not included', body: '' },
    ],
    defaultTerms: [
      'All prices are in GBP and exclude VAT unless stated otherwise.',
      'This proposal is valid for the period shown above. Equipment prices may change after that date.',
      'A deposit of 50% is due on acceptance, with the balance due on completion.',
      'Equipment remains the property of Mesh Smart Home Technology until paid for in full.',
      'Any work outside the scope described in this proposal will be quoted separately.',
    ].join('\n'),
  };
}

module.exports = { defaultSettings };
