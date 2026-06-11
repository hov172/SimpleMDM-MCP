// Legacy Mac model identifiers → marketing name + release year, for models
// the SOFA feed no longer carries (SOFA only lists currently-supported Macs).
// Pre-SOFA hardware is a frozen set, so a curated table is deterministic and
// offline — no runtime lookups. Sources (Apple "Identify your model" pages):
//   iMac        https://support.apple.com/en-us/108054
//   MacBook Pro https://support.apple.com/en-us/108052
//   MacBook Air https://support.apple.com/en-us/102869
//   MacBook     https://support.apple.com/en-us/103257
//   Mac mini    https://support.apple.com/en-us/102852
//   Mac Pro     https://support.apple.com/en-us/102887
// SOFA entries overlay these in buildModelMap, so anything SOFA knows wins.

export const LEGACY_MODELS = {
  // iMac — https://support.apple.com/en-us/108054
  "iMac20,2": { marketing: "iMac (Retina 5K, 27-inch, 2020)", year: "2020" },
  "iMac20,1": { marketing: "iMac (Retina 5K, 27-inch, 2020)", year: "2020" },
  "iMac19,1": { marketing: "iMac (Retina 5K, 27-inch, 2019)", year: "2019" },
  "iMac19,2": { marketing: "iMac (Retina 4K, 21.5-inch, 2019)", year: "2019" },
  "iMacPro1,1": { marketing: "iMac Pro (2017)", year: "2017" },
  "iMac18,3": { marketing: "iMac (Retina 5K, 27-inch, 2017)", year: "2017" },
  "iMac18,2": { marketing: "iMac (Retina 4K, 21.5-inch, 2017)", year: "2017" },
  "iMac18,1": { marketing: "iMac (21.5-inch, 2017)", year: "2017" },
  "iMac17,1": { marketing: "iMac (Retina 5K, 27-inch, Late 2015)", year: "2015" },
  "iMac16,2": { marketing: "iMac (Retina 4K, 21.5-inch, Late 2015)", year: "2015" },
  "iMac16,1": { marketing: "iMac (21.5-inch, Late 2015)", year: "2015" },
  "iMac15,1": { marketing: "iMac (Retina 5K, 27-inch, Late 2014)", year: "2014" },
  "iMac14,4": { marketing: "iMac (21.5-inch, Mid 2014)", year: "2014" },
  "iMac14,3": { marketing: "iMac (21.5-inch, Late 2013)", year: "2013" },
  "iMac14,2": { marketing: "iMac (27-inch, Late 2013)", year: "2013" },
  "iMac14,1": { marketing: "iMac (21.5-inch, Late 2013)", year: "2013" },
  "iMac13,2": { marketing: "iMac (27-inch, Late 2012)", year: "2012" },
  "iMac13,1": { marketing: "iMac (21.5-inch, Late 2012)", year: "2012" },
  "iMac12,2": { marketing: "iMac (27-inch, Mid 2011)", year: "2011" },
  "iMac12,1": { marketing: "iMac (21.5-inch, Mid 2011)", year: "2011" },
  "iMac11,3": { marketing: "iMac (27-inch, Mid 2010)", year: "2010" },
  "iMac11,2": { marketing: "iMac (21.5-inch, Mid 2010)", year: "2010" },
  "iMac10,1": { marketing: "iMac (Late 2009)", year: "2009" },

  // MacBook Pro — https://support.apple.com/en-us/108052
  "MacBookPro16,4": { marketing: "MacBook Pro (16-inch, 2019)", year: "2019" },
  "MacBookPro16,3": { marketing: "MacBook Pro (13-inch, 2020, Two Thunderbolt 3 ports)", year: "2020" },
  "MacBookPro16,2": { marketing: "MacBook Pro (13-inch, 2020, Four Thunderbolt 3 ports)", year: "2020" },
  "MacBookPro16,1": { marketing: "MacBook Pro (16-inch, 2019)", year: "2019" },
  "MacBookPro15,4": { marketing: "MacBook Pro (13-inch, 2019, Two Thunderbolt 3 ports)", year: "2019" },
  "MacBookPro15,3": { marketing: "MacBook Pro (15-inch, 2019)", year: "2019" },
  "MacBookPro15,2": { marketing: "MacBook Pro (13-inch, 2018/2019, Four Thunderbolt 3 ports)", year: "2018" },
  "MacBookPro15,1": { marketing: "MacBook Pro (15-inch, 2018/2019)", year: "2018" },
  "MacBookPro14,3": { marketing: "MacBook Pro (15-inch, 2017)", year: "2017" },
  "MacBookPro14,2": { marketing: "MacBook Pro (13-inch, 2017, Four Thunderbolt 3 ports)", year: "2017" },
  "MacBookPro14,1": { marketing: "MacBook Pro (13-inch, 2017, Two Thunderbolt 3 ports)", year: "2017" },
  "MacBookPro13,3": { marketing: "MacBook Pro (15-inch, 2016)", year: "2016" },
  "MacBookPro13,2": { marketing: "MacBook Pro (13-inch, 2016, Four Thunderbolt 3 ports)", year: "2016" },
  "MacBookPro13,1": { marketing: "MacBook Pro (13-inch, 2016, Two Thunderbolt 3 ports)", year: "2016" },
  "MacBookPro12,1": { marketing: "MacBook Pro (Retina, 13-inch, Early 2015)", year: "2015" },
  "MacBookPro11,5": { marketing: "MacBook Pro (Retina, 15-inch, Mid 2015)", year: "2015" },
  "MacBookPro11,4": { marketing: "MacBook Pro (Retina, 15-inch, Mid 2015)", year: "2015" },
  "MacBookPro11,3": { marketing: "MacBook Pro (Retina, 15-inch, Late 2013/Mid 2014)", year: "2013" },
  "MacBookPro11,2": { marketing: "MacBook Pro (Retina, 15-inch, Late 2013/Mid 2014)", year: "2013" },
  "MacBookPro11,1": { marketing: "MacBook Pro (Retina, 13-inch, Late 2013/Mid 2014)", year: "2013" },
  "MacBookPro10,2": { marketing: "MacBook Pro (Retina, 13-inch, Late 2012/Early 2013)", year: "2012" },
  "MacBookPro10,1": { marketing: "MacBook Pro (Retina, 15-inch, Mid 2012/Early 2013)", year: "2012" },
  "MacBookPro9,2": { marketing: "MacBook Pro (13-inch, Mid 2012)", year: "2012" },
  "MacBookPro9,1": { marketing: "MacBook Pro (15-inch, Mid 2012)", year: "2012" },

  // MacBook Air — https://support.apple.com/en-us/102869
  "MacBookAir9,1": { marketing: "MacBook Air (Retina, 13-inch, 2020)", year: "2020" },
  "MacBookAir8,2": { marketing: "MacBook Air (Retina, 13-inch, 2019)", year: "2019" },
  "MacBookAir8,1": { marketing: "MacBook Air (Retina, 13-inch, 2018)", year: "2018" },
  "MacBookAir7,2": { marketing: "MacBook Air (13-inch, Early 2015/2017)", year: "2015" },
  "MacBookAir7,1": { marketing: "MacBook Air (11-inch, Early 2015)", year: "2015" },
  "MacBookAir6,2": { marketing: "MacBook Air (13-inch, Mid 2013/Early 2014)", year: "2013" },
  "MacBookAir6,1": { marketing: "MacBook Air (11-inch, Mid 2013/Early 2014)", year: "2013" },
  "MacBookAir5,2": { marketing: "MacBook Air (13-inch, Mid 2012)", year: "2012" },
  "MacBookAir5,1": { marketing: "MacBook Air (11-inch, Mid 2012)", year: "2012" },

  // MacBook — https://support.apple.com/en-us/103257
  "MacBook10,1": { marketing: "MacBook (Retina, 12-inch, 2017)", year: "2017" },
  "MacBook9,1": { marketing: "MacBook (Retina, 12-inch, Early 2016)", year: "2016" },
  "MacBook8,1": { marketing: "MacBook (Retina, 12-inch, Early 2015)", year: "2015" },

  // Mac mini — https://support.apple.com/en-us/102852
  "Macmini8,1": { marketing: "Mac mini (2018)", year: "2018" },
  "Macmini7,1": { marketing: "Mac mini (Late 2014)", year: "2014" },
  "Macmini6,2": { marketing: "Mac mini (Late 2012)", year: "2012" },
  "Macmini6,1": { marketing: "Mac mini (Late 2012)", year: "2012" },
  "Macmini5,3": { marketing: "Mac mini (Mid 2011)", year: "2011" },
  "Macmini5,2": { marketing: "Mac mini (Mid 2011)", year: "2011" },
  "Macmini5,1": { marketing: "Mac mini (Mid 2011)", year: "2011" },

  // Mac Pro — https://support.apple.com/en-us/102887
  "MacPro7,1": { marketing: "Mac Pro (2019)", year: "2019" },
  "MacPro6,1": { marketing: "Mac Pro (Late 2013)", year: "2013" },
  "MacPro5,1": { marketing: "Mac Pro (Mid 2010/Mid 2012)", year: "2010" },
};
