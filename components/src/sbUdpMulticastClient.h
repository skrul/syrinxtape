/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
#ifndef __SBUDPMULTICASTCLIENT__
#define __SBUDPMULTICASTCLIENT__

#include <sbIUdpMulticastClient.h>

#include <nsIRunnable.h>
#include <nsStringGlue.h>
#include <nsCOMPtr.h>
#include <nsTArray.h>

class stNetUtils : public stINetUtils
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_STINETUTILS

  stNetUtils();
  ~stNetUtils();
};

class stUdpMulticastWorker : public nsIRunnable
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIRUNNABLE

  nsresult Init(const nsACString& aIpAddress,
                PRUint16 aPort,
                PRUint64 aTimeout,
                PRUint32 aSendLength,
                PRUint8* aSendBytes,
                stIUdpMulticastCallback* aCallback);

private:
  nsCString mIpAddress;
  PRUint16 mPort;
  PRUint64 mTimeout;
  nsTArray<PRUint8> mSendBytes;
  nsCOMPtr<stIUdpMulticastCallback> mCallback;
};

#endif /* __SBUDPMULTICASTCLIENT__ */
