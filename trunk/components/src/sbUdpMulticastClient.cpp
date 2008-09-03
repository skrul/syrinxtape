/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
#include "sbUdpMulticastClient.h"

#include <prnetdb.h>
#include <nsAutoPtr.h>
#include <nsThreadUtils.h>
#include <nsIThread.h>
#include <nsIEventTarget.h>
#include <nsIProxyObjectManager.h>
#include <nsServiceManagerUtils.h>
#include <nsXPCOMCIDInternal.h>

#define UDP_TIMEOUT 400000
#define READ_BUFFER 4096

NS_IMPL_ISUPPORTS1(sbUdpMulticastClient, sbIUdpMulticastClient)

sbUdpMulticastClient::sbUdpMulticastClient()
{
}

sbUdpMulticastClient::~sbUdpMulticastClient()
{
}

NS_IMETHODIMP
sbUdpMulticastClient::Send(const nsACString& aIpAddress,
                           PRUint16 aPort,
                           PRUint64 aTimeout,
                           PRUint32 aSendLength,
                           PRUint8* aSendBytes,
                           sbIUdpMulticastClientCallback* aCallback)
{
  NS_ENSURE_ARG_POINTER(aSendBytes);
  NS_ENSURE_ARG_POINTER(aCallback);
  nsresult rv;

  nsCOMPtr<nsIProxyObjectManager> pom =
    do_GetService(NS_XPCOMPROXY_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<sbIUdpMulticastClientCallback> proxiedCallback;
  rv = pom->GetProxyForObject(NS_PROXY_TO_MAIN_THREAD,
                              NS_GET_IID(sbIUdpMulticastClientCallback),
                              aCallback,
                              NS_PROXY_SYNC | NS_PROXY_ALWAYS,
                              getter_AddRefs(proxiedCallback));
  NS_ENSURE_SUCCESS(rv, rv);

  nsRefPtr<sbUdpMulticastClientWorker> worker =
    new sbUdpMulticastClientWorker();
  NS_ENSURE_TRUE(worker, NS_ERROR_OUT_OF_MEMORY);

  rv = worker->Init(aIpAddress,
                    aPort,
                    aTimeout,
                    aSendLength,
                    aSendBytes,
                    proxiedCallback);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIThread> thread;
  return NS_NewThread(getter_AddRefs(thread), worker);
}

NS_IMPL_THREADSAFE_ISUPPORTS1(sbUdpMulticastClientWorker, nsIRunnable)

nsresult
sbUdpMulticastClientWorker::Init(const nsACString& aIpAddress,
                                 PRUint16 aPort,
                                 PRUint64 aTimeout,
                                 PRUint32 aSendLength,
                                 PRUint8* aSendBytes,
                                 sbIUdpMulticastClientCallback* aCallback)
{
  NS_ASSERTION(aSendBytes, "aSendBytes is null");
  NS_ASSERTION(aCallback, "aCallback is null");

  mIpAddress = aIpAddress;
  mPort = aPort;
  mTimeout = aTimeout;
  mCallback = aCallback;

  PRUint8* success = mSendBytes.AppendElements(aSendBytes, aSendLength);
  NS_ENSURE_TRUE(success, NS_ERROR_OUT_OF_MEMORY);

  return NS_OK;
}

NS_IMETHODIMP
sbUdpMulticastClientWorker::Run()
{
  PRNetAddr addr;
  PRStatus result = PR_StringToNetAddr(mIpAddress.BeginReading(), &addr);
  if (result != PR_SUCCESS) {
    mCallback->Done(NS_ERROR_INVALID_ARG);
    return NS_OK;
  }

  PRNetAddr readAddr;
  readAddr.inet.family = PR_AF_INET;
  readAddr.inet.ip = PR_htonl(PR_INADDR_ANY);

  PRNetAddr writeAddr;
  writeAddr.inet.family = PR_AF_INET;
  writeAddr.inet.port = PR_htons(mPort);
  writeAddr.inet.ip = addr.inet.ip;

  PRFileDesc* socket = PR_NewUDPSocket();
  if (!socket) {
    mCallback->Done(NS_ERROR_OUT_OF_MEMORY);
    return NS_OK;
  }

  result = PR_Bind(socket, &readAddr);
  if (result != PR_SUCCESS) {
    mCallback->Done(NS_ERROR_FAILURE);
    PR_Close(socket);
    return NS_OK;
  }

  PRInt32 send = PR_SendTo(socket,
                           mSendBytes.Elements(),
                           mSendBytes.Length(),
                           0,
                           &writeAddr,
                           UDP_TIMEOUT);
  if (send != (PRInt32) mSendBytes.Length()) {
    mCallback->Done(NS_ERROR_FAILURE);
    PR_Close(socket);
    return NS_OK;
  }

  while (PR_TRUE) {
    char buff[READ_BUFFER];
    bzero(&buff, READ_BUFFER);

    PRInt32 read = PR_RecvFrom(socket,
                               &buff,
                               READ_BUFFER,
                               0,
                               &readAddr,
                               mTimeout);

    if (read > 0) {
      mCallback->Receive(read, (PRUint8*) &buff);
    }
    else {
      break;
    }
  }

  mCallback->Done(NS_OK);
  PR_Close(socket);
  return NS_OK;
}
