/*
 * Copyright (C) 2008 by Steve Krulewitz <skrulx@gmail.com>
 * Licensed under GPLv2 or later, see file LICENSE in the xpi for details.
 */
#include "stNetUtils.h"

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

NS_IMPL_ISUPPORTS1(stNetUtils, stINetUtils)

stNetUtils::stNetUtils()
{
}

stNetUtils::~stNetUtils()
{
}

NS_IMETHODIMP
stNetUtils::SendUdpMulticast(const nsACString& aIpAddress,
                             PRUint16 aPort,
                             PRUint64 aTimeout,
                             PRUint32 aSendLength,
                             PRUint8* aSendBytes,
                             stIUdpMulticastCallback* aCallback)
{
  NS_ENSURE_ARG_POINTER(aSendBytes);
  NS_ENSURE_ARG_POINTER(aCallback);
  nsresult rv;

  nsCOMPtr<nsIProxyObjectManager> pom =
    do_GetService(NS_XPCOMPROXY_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<stIUdpMulticastCallback> proxiedCallback;
  rv = pom->GetProxyForObject(NS_PROXY_TO_MAIN_THREAD,
                              NS_GET_IID(stIUdpMulticastCallback),
                              aCallback,
                              NS_PROXY_SYNC | NS_PROXY_ALWAYS,
                              getter_AddRefs(proxiedCallback));
  NS_ENSURE_SUCCESS(rv, rv);

  nsRefPtr<stUdpMulticastWorker> worker =
    new stUdpMulticastWorker();
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

NS_IMETHODIMP
stNetUtils::GetLocalIpAddress(const nsACString& aRemoteIpAddress,
                              PRUint16 aRemotePort,
                              PRUint64 aTimeout,
                              stILocalIpAddressCallback* aCallback)
{
  NS_ENSURE_ARG_POINTER(aCallback);
  nsresult rv;

  nsCOMPtr<nsIProxyObjectManager> pom =
    do_GetService(NS_XPCOMPROXY_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<stILocalIpAddressCallback> proxiedCallback;
  rv = pom->GetProxyForObject(NS_PROXY_TO_MAIN_THREAD,
                              NS_GET_IID(stILocalIpAddressCallback),
                              aCallback,
                              NS_PROXY_SYNC | NS_PROXY_ALWAYS,
                              getter_AddRefs(proxiedCallback));
  NS_ENSURE_SUCCESS(rv, rv);

  nsRefPtr<stLocalIpAddressWorker> worker =
    new stLocalIpAddressWorker();
  NS_ENSURE_TRUE(worker, NS_ERROR_OUT_OF_MEMORY);

  rv = worker->Init(aRemoteIpAddress,
                    aRemotePort,
                    aTimeout,
                    proxiedCallback);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIThread> thread;
  return NS_NewThread(getter_AddRefs(thread), worker);
}

NS_IMPL_THREADSAFE_ISUPPORTS1(stUdpMulticastWorker, nsIRunnable)

#define ST_ENSURE_TRUE_DONE(expr, socket, result) \
  PR_BEGIN_MACRO                                  \
    if (!expr) {                                  \
      mCallback->Done(result);                    \
      if (socket) {                               \
        PR_Close(socket);                         \
      }                                           \
      return NS_OK;                               \
    }                                             \
  PR_END_MACRO

nsresult
stUdpMulticastWorker::Init(const nsACString& aIpAddress,
                           PRUint16 aPort,
                           PRUint64 aTimeout,
                           PRUint32 aSendLength,
                           PRUint8* aSendBytes,
                           stIUdpMulticastCallback* aCallback)
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
stUdpMulticastWorker::Run()
{
  PRNetAddr addr;
  PRStatus result = PR_StringToNetAddr(mIpAddress.BeginReading(), &addr);
  ST_ENSURE_TRUE_DONE(result == PR_SUCCESS, nsnull, NS_ERROR_INVALID_ARG);

  PRNetAddr readAddr;
  readAddr.inet.family = PR_AF_INET;
  readAddr.inet.ip = PR_htonl(PR_INADDR_ANY);

  PRNetAddr writeAddr;
  writeAddr.inet.family = PR_AF_INET;
  writeAddr.inet.port = PR_htons(mPort);
  writeAddr.inet.ip = addr.inet.ip;

  PRFileDesc* socket = PR_NewUDPSocket();
  ST_ENSURE_TRUE_DONE(socket, socket, NS_ERROR_OUT_OF_MEMORY);

  result = PR_Bind(socket, &readAddr);
  ST_ENSURE_TRUE_DONE(result == PR_SUCCESS, socket, NS_ERROR_FAILURE);

  PRInt32 send = PR_SendTo(socket,
                           mSendBytes.Elements(),
                           mSendBytes.Length(),
                           0,
                           &writeAddr,
                           UDP_TIMEOUT);
  ST_ENSURE_TRUE_DONE(send == (PRInt32) mSendBytes.Length(),
                 socket,
                 NS_ERROR_FAILURE);

  while (PR_TRUE) {
    char buff[READ_BUFFER];
    memset(buff, 0, READ_BUFFER);

    PRInt32 read = PR_RecvFrom(socket,
                               buff,
                               READ_BUFFER,
                               0,
                               &readAddr,
                               mTimeout);

    if (read > 0) {
      mCallback->Receive(read, (PRUint8*) buff);
    }
    else {
      break;
    }
  }

  PR_Close(socket);
  mCallback->Done(NS_OK);
  return NS_OK;
}

NS_IMPL_THREADSAFE_ISUPPORTS1(stLocalIpAddressWorker, nsIRunnable)

#define ST_ENSURE_TRUE_RESPONSE(expr, socket, result) \
  PR_BEGIN_MACRO                                      \
    if (!expr) {                                      \
      mCallback->Response(result, EmptyCString());    \
      if (socket) {                                   \
        PR_Close(socket);                             \
      }                                               \
      return NS_OK;                                   \
    }                                                 \
  PR_END_MACRO

nsresult
stLocalIpAddressWorker::Init(const nsACString& aRemoteIpAddress,
                             PRUint16 aRemotePort,
                             PRUint64 aTimeout,
                             stILocalIpAddressCallback* aCallback)
{
  NS_ASSERTION(aCallback, "aCallback is null");

  mRemoteIpAddress = aRemoteIpAddress;
  mRemotePort = aRemotePort;
  mTimeout = aTimeout;
  mCallback = aCallback;

  return NS_OK;
}

NS_IMETHODIMP
stLocalIpAddressWorker::Run()
{
  PRNetAddr addr;
  PRStatus result = PR_StringToNetAddr(mRemoteIpAddress.BeginReading(), &addr);
  ST_ENSURE_TRUE_RESPONSE(result == PR_SUCCESS, nsnull, NS_ERROR_FAILURE);

  addr.inet.family = PR_AF_INET;
  addr.inet.port = PR_htons(mRemotePort);

  PRFileDesc* socket = PR_NewUDPSocket();
  ST_ENSURE_TRUE_RESPONSE(socket, socket, NS_ERROR_OUT_OF_MEMORY);

  result = PR_Connect(socket, &addr, mTimeout);
  ST_ENSURE_TRUE_RESPONSE(result == PR_SUCCESS, socket, NS_ERROR_FAILURE);

  PRNetAddr myAddr;
  result = PR_GetSockName(socket, &myAddr);
  ST_ENSURE_TRUE_RESPONSE(result == PR_SUCCESS, socket, NS_ERROR_FAILURE);

  char s[16];
  result = PR_NetAddrToString(&myAddr, s, 16);
  ST_ENSURE_TRUE_RESPONSE(result == PR_SUCCESS, socket, NS_ERROR_FAILURE);

  PR_Close(socket);
  mCallback->Response(NS_OK, nsDependentCString(s));
  return NS_OK;
}
