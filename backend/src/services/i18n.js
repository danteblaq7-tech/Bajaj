// Swahili versions of the notifications and SMS the server sends. English is the source text.
// Please have a native Swahili speaker review these before launch.
const TITLES = {
  'High demand': 'Wateja ni wengi', 'Trip complete': 'Safari imekamilika', 'Parcel pickup': 'Kuchukua kifurushi',
  'Driver on the way': 'Dereva yuko njiani', 'Incident outcome': 'Matokeo ya tukio', 'Parcel delivered': 'Kifurushi kimefikishwa',
  'Driver assigned': 'Dereva amepangiwa', 'Parcel collected': 'Kifurushi kimechukuliwa', 'Booking cancelled': 'Uhifadhi umeghairiwa',
  'Payment failed': 'Malipo hayakufanikiwa', 'Payment received': 'Malipo yamepokelewa', 'Account approved': 'Akaunti imeidhinishwa',
  'Subscription suspended': 'Usajili umesitishwa', 'Subscription renewal': 'Kuhuisha usajili', 'New ride request': 'Ombi jipya la safari',
  'Account suspended': 'Akaunti imesitishwa', 'Payout sent': 'Malipo yametumwa',
};
const RULES = [
  [/^All our tuktuks are busy\. We are still looking, or you can schedule a pickup for later\.$/, 'Tuktuk zetu zote zina shughuli. Bado tunatafuta, au unaweza kupanga kuchukuliwa baadaye.'],
  [/^Thanks for riding with Pwani Ride\. Fare: KES (.+)\. Please rate your driver\.$/, 'Asante kwa kusafiri na Pwani Ride. Nauli: KES $1. Tafadhali mpe dereva wako alama.'],
  [/^Collect parcel (\S+) at (.+)\.$/, 'Chukua kifurushi $1 kutoka $2.'],
  [/^(.+) in (.+), about (\d+) min away\.$/, '$1 katika $2, yuko umbali wa takriban dakika $3.'],
  [/^Your account was suspended after an incident review\.$/, 'Akaunti yako imesitishwa baada ya mapitio ya tukio.'],
  [/^You have received a formal warning after an incident review\.$/, 'Umepokea onyo rasmi baada ya mapitio ya tukio.'],
  [/^Parcel (\S+) was delivered to (.+)\.$/, 'Kifurushi $1 kimefikishwa kwa $2.'],
  [/^A driver is heading to collect parcel (\S+)\.$/, 'Dereva anaelekea kuchukua kifurushi $1.'],
  [/^Parcel (\S+) is in transit\.$/, 'Kifurushi $1 kiko njiani.'],
  [/^We cancelled your booking after several failed payments\.$/, 'Tumeghairi uhifadhi wako baada ya malipo kushindwa mara kadhaa.'],
  [/^Your payment did not go through\. Please try again\.$/, 'Malipo yako hayakukamilika. Tafadhali jaribu tena.'],
  [/^KES (.+) received\. Receipt (.+)\.$/, 'KES $1 imepokelewa. Risiti $2.'],
  [/^Your driver account is active\. You can start a shift\.$/, 'Akaunti yako ya udereva inafanya kazi. Unaweza kuanza zamu.'],
  [/^Your subscription was suspended because the renewal was not paid\.$/, 'Usajili wako umesitishwa kwa sababu malipo ya kuhuisha hayakulipwa.'],
  [/^Your renewal of KES (.+) is due\. You have 3 days to pay\.$/, 'Malipo yako ya kuhuisha ya KES $1 yanastahili. Una siku 3 za kulipa.'],
  [/^Pickup: (.+)\. Respond within (\d+)s\.$/, 'Kuchukua: $1. Jibu ndani ya sekunde $2.'],
  [/^Your driver account was suspended\. Contact Operations\.$/, 'Akaunti yako ya udereva imesitishwa. Wasiliana na Operesheni.'],
  [/^KES (.+) was sent to your M-Pesa\. Receipt (.+)\.$/, 'KES $1 imetumwa kwa M-Pesa yako. Risiti $2.'],
  [/^Your Pwani Ride code is (\d+)\. It expires in (\d+) minutes\.$/, 'Nambari yako ya Pwani Ride ni $1. Itaisha baada ya dakika $2.'],
];
function tr(lang, text) {
  if (lang !== 'sw' || typeof text !== 'string') return text;
  if (TITLES[text]) return TITLES[text];
  for (const [re, out] of RULES) if (re.test(text)) return text.replace(re, out);
  return text;
}
module.exports = { tr };
