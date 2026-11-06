# Firewall on arch

Keeps other devices off the k3s networks and Ollama, so llmgw and mcpgw are reachable only from arch
([ADR 0008](../../docs/adr/0008-only-arch-and-the-cluster-no-auth.md)).

```sh
sudo install -Dm644 deploy/host/arch-only.nft /etc/nftables.d/arch-only.nft
sudo install -Dm644 deploy/host/arch-only-firewall.service /etc/systemd/system/arch-only-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now arch-only-firewall
```

It has its own service rather than `nftables.service`, and only ever touches its own table, so it can't disturb k3s's rules.

- **Check it:** `sudo nft list table inet arch_only`.
- **Undo it:** `sudo systemctl disable --now arch-only-firewall`.
- **Ollama:** blocked from other devices. llmgw isn't affected, because its pods don't arrive over Wi-Fi or Ethernet. If
  another device needs it, remove those two lines, reinstall the file and `sudo systemctl restart arch-only-firewall`.
- **Quick check from a phone or laptop on the network:** `http://192.168.1.163:11434` shows "Ollama is running" without the
  rule, and never loads with it.

**Tested** in a throwaway network namespace with a veth named like a Wi-Fi card, not on the real network: a simulated LAN
device reaches the Service and pod ranges without the rule and is blocked with it, while Traefik and arch itself keep
working. To test it for real from another machine: `sudo ip route add 10.43.0.0/16 via 192.168.1.163`, then
`curl -m 5 http://10.43.151.52/` should time out. Remove the route afterwards.
