export type RespondeFromDajavu = {
  Amounts: Amounts;
  GeneralResponse: GeneralResponse;
  PaymentType: string;
  TransactionType: string;
  AuthCode: string;
  ReferenceId: string;
  InvoiceNumber: string;
  SerialNumber: string;
  BatchNumber: string;
  TransactionNumber: string;
  Voided: boolean;
  PNReferenceId: string;
  ExtendedDataByApplication: ExtendedDataByApplication;
  CardData: CardData;
  EMVData: EMVData;
};

export type Amounts = {
  TotalAmount: number;
  Amount: number;
  TipAmount: number;
  FeeAmount: number;
  TaxAmount: number;
};

export type CardData = {
  CardType: string;
  EntryType: string;
  Last4: string;
  First4: string;
  BIN: string;
  Name: string;
};

export type EMVData = {
  ApplicationName: string;
  AID: string;
  TVR: string;
  TSI: string;
  IAD: string;
  ARC: string;
};

export type ExtendedDataByApplication = {
  "CHASE VISA": ChaseVisa;
};

export type ChaseVisa = {
  Amount: string;
  InvNum: string;
  CardType: string;
  BatchNum: string;
  Tip: string;
  CashBack: string;
  Fee: string;
  AcntLast4: string;
  BIN: string;
  Name: string;
  SVC: string;
  TotalAmt: string;
  DISC: string;
  Donation: string;
  SHFee: string;
  RwdPoints: string;
  RwdBalance: string;
  Language: string;
  EntryType: string;
  TableNum: string;
  TaxCity: string;
  TaxState: string;
  TaxReducedState: string;
  AcntFirst4: string;
  TaxAmount: string;
  TransactionID: string;
  ExtraHostData: string;
  AID: string;
  AppName: string;
  TVR: string;
  TSI: string;
  IAD: string;
};

export type GeneralResponse = {
  HostResponseCode: string;
  HostResponseMessage: string;
  ResultCode: string;
  StatusCode: string;
  Message: string;
  DetailedMessage: string;
};
